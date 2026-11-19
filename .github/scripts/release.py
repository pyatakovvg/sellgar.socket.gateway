import argparse
import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


WORKFLOW_PATH = ".github/workflows/ci.yml"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def github(path, method="GET", body=None):
    request = Request(
        f"{os.environ['GITHUB_API_URL']}/repos/{os.environ['GITHUB_REPOSITORY']}/{path}",
        method=method,
        data=None if body is None else json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2026-03-10",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"GitHub API {method} {path} failed: HTTP {error.code}") from error


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def output(**values):
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as file:
        for name, value in values.items():
            require("\n" not in str(value) and "\r" not in str(value), "Invalid workflow output")
            file.write(f"{name}={value}\n")


def summary(text):
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as file:
        file.write(text + "\n")


def validate_image(image, repository):
    require(image["repository"] == f"ghcr.io/{repository.lower()}", "Unexpected image repository")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", image["digest"]), "Invalid image digest")
    return f"{image['repository']}@{image['digest']}"


def record(directory):
    branch = os.environ["GITHUB_REF_NAME"]
    require(branch == "development" or branch.startswith("release/"), "Not a build branch")
    manifest = {
        "schema_version": 1,
        "repository": os.environ["GITHUB_REPOSITORY"],
        "environment": "dev" if branch == "development" else "stage",
        "source": {
            "branch": branch,
            "commit": os.environ["GITHUB_SHA"],
            "tree": os.environ["SOURCE_TREE"],
        },
        "build": {
            "workflow": WORKFLOW_PATH,
            "run_id": int(os.environ["GITHUB_RUN_ID"]),
            "attempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
        },
        "image": {
            "repository": f"ghcr.io/{os.environ['GITHUB_REPOSITORY'].lower()}",
            "digest": os.environ["IMAGE_DIGEST"],
        },
    }
    image = validate_image(manifest["image"], manifest["repository"])
    write_json(directory / "release.json", manifest)
    write_json(directory / "image-values.yaml", {"image": manifest["image"]})
    if manifest["environment"] == "dev":
        summary(f"### Development image\n\n`{image}`")
        return

    run_id = manifest["build"]["run_id"]
    summary(
        f"### Release build\n\n- Branch: `{branch}`\n- Image: `{image}`\n"
        f"- Release run ID: `{run_id}`\n"
        f"- Run: {os.environ['GITHUB_SERVER_URL']}/{manifest['repository']}/actions/runs/{run_id}\n"
        "\nFor production, merge this release into master and use Release to production → Run workflow."
    )


def validate_run(run, repository):
    require(run["repository"]["full_name"] == repository, "Build belongs to another repository")
    require(run["path"] == WORKFLOW_PATH, "Build comes from another workflow")
    require(run["event"] == "push", "Only push builds can be promoted")
    require(run["head_branch"].startswith("release/"), "Select a release/* build")
    require(run["status"] == "completed" and run["conclusion"] == "success", "Release CI must succeed")


def selected_run(run_id):
    require(os.environ["GITHUB_REF"] == "refs/heads/master", "Run production workflow from master")
    require(re.fullmatch(r"[1-9][0-9]*", run_id), "Release run ID must be a positive integer")
    run = github(f"actions/runs/{run_id}")
    validate_run(run, os.environ["GITHUB_REPOSITORY"])
    require(run["id"] == int(run_id), "Unexpected build run ID")
    return run


def validate_manifest(manifest, run, repository):
    require(manifest["schema_version"] == 1, "Unsupported release manifest version")
    require(manifest["repository"] == repository, "Manifest belongs to another repository")
    require(manifest["environment"] == "stage", "Only release candidates can be promoted")
    require(manifest["build"]["run_id"] == run["id"], "Manifest belongs to another CI run")
    require(manifest["build"]["workflow"] == WORKFLOW_PATH, "Unexpected manifest workflow")
    require(1 <= manifest["build"]["attempt"] <= run["run_attempt"], "Invalid build attempt")
    require(manifest["source"]["commit"] == run["head_sha"], "Manifest source does not match CI")
    require(manifest["source"]["branch"] == run["head_branch"], "Manifest branch does not match CI")
    require(re.fullmatch(r"[0-9a-f]{40}", manifest["source"]["commit"]), "Invalid source commit")
    require(re.fullmatch(r"[0-9a-f]{40}", manifest["source"]["tree"]), "Invalid source tree")
    return validate_image(manifest["image"], repository)


def verify(run_id, directory):
    run = selected_run(run_id)
    manifest = json.loads((directory / "release.json").read_text(encoding="utf-8"))
    image = validate_manifest(manifest, run, os.environ["GITHUB_REPOSITORY"])
    source = github(f"commits/{manifest['source']['commit']}")
    master = github("commits/master")
    require(master["sha"] == os.environ["GITHUB_SHA"], "master advanced; start a new production run")
    require(source["commit"]["tree"]["sha"] == manifest["source"]["tree"], "Unexpected release tree")
    require(master["commit"]["tree"]["sha"] == manifest["source"]["tree"], "master differs from tested release")
    comparison = github(f"compare/{manifest['source']['commit']}...{master['sha']}?per_page=1")
    require(comparison["status"] in {"ahead", "identical"}, "Release commit has not been merged into master")
    output(
        image=image,
        image_repository=manifest["image"]["repository"],
        image_digest=manifest["image"]["digest"],
        source_commit=manifest["source"]["commit"],
        master_commit=master["sha"],
    )
    return manifest


def promote(run_id, directory):
    # Recheck after pulling and testing the image to reject a stale queued release.
    manifest = verify(run_id, directory)
    manifest["environment"] = "prod"
    manifest["promotion"] = {
        "master_commit": os.environ["GITHUB_SHA"],
        "run_id": int(os.environ["GITHUB_RUN_ID"]),
        "actor": os.environ["GITHUB_ACTOR"],
    }
    write_json(directory / "production" / "release.json", manifest)
    write_json(directory / "production" / "image-values.yaml", {"image": manifest["image"]})
    summary(
        f"### Approved production release\n\n"
        f"- Image: `{manifest['image']['repository']}@{manifest['image']['digest']}`\n"
        f"- Source: `{manifest['source']['commit']}`\n"
        f"- Master: `{os.environ['GITHUB_SHA']}`\n"
        f"- Approved by manual workflow: `{os.environ['GITHUB_ACTOR']}`\n\n"
        "Artifact production-release contains the deployment input. Kubernetes rollout is not connected yet."
    )


def back_merge():
    require(os.environ["GITHUB_REF"] == "refs/heads/master", "Back-merge must run from master")
    comparison = github("compare/development...master?per_page=1")
    if comparison["ahead_by"] == 0:
        summary("development already contains master.")
        return

    owner = os.environ["GITHUB_REPOSITORY"].split("/")[0]
    query = urlencode({"state": "open", "base": "development", "head": f"{owner}:master"})
    existing = github(f"pulls?{query}")
    pull_request = existing[0] if existing else github(
        "pulls",
        method="POST",
        body={
            "title": "chore: merge master into development",
            "head": "master",
            "base": "development",
            "body": "Возврат изменений принятого релиза из master в development. "
            "Создан после ручной подготовки production-выпуска; слияние выполняется после checks.",
        },
    )
    summary(f"### Back-merge\n\n{pull_request['html_url']}")


def main():
    parser = argparse.ArgumentParser(description="Record and promote verified Admin UI builds")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("record").add_argument("directory", type=Path)
    commands.add_parser("check-run").add_argument("run_id")
    for command in ["verify", "promote"]:
        subparser = commands.add_parser(command)
        subparser.add_argument("run_id")
        subparser.add_argument("directory", type=Path)
    commands.add_parser("back-merge")
    arguments = parser.parse_args()

    if arguments.command == "record":
        record(arguments.directory)
    elif arguments.command == "check-run":
        selected_run(arguments.run_id)
    elif arguments.command == "verify":
        verify(arguments.run_id, arguments.directory)
    elif arguments.command == "promote":
        promote(arguments.run_id, arguments.directory)
    else:
        back_merge()


if __name__ == "__main__":
    main()
