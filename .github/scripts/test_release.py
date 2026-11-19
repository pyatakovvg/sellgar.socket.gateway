import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import release


REPOSITORY = "pyatakovvg/sellgar.ui.admin"
SOURCE_COMMIT = "1" * 40
MASTER_COMMIT = "2" * 40
SOURCE_TREE = "3" * 40
DIGEST = "sha256:" + "4" * 64


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.environment = patch.dict(os.environ, {
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_REF": "refs/heads/master",
            "GITHUB_REF_NAME": "release/1.2.0",
            "GITHUB_SHA": MASTER_COMMIT,
            "GITHUB_RUN_ID": "200",
            "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_ACTOR": "maintainer",
            "GITHUB_SERVER_URL": "https://github.com",
            "GITHUB_OUTPUT": str(self.path / "outputs"),
            "GITHUB_STEP_SUMMARY": str(self.path / "summary"),
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.run = {
            "id": 100,
            "repository": {"full_name": REPOSITORY},
            "path": release.WORKFLOW_PATH,
            "event": "push",
            "head_branch": "release/1.2.0",
            "head_sha": SOURCE_COMMIT,
            "run_attempt": 1,
            "status": "completed",
            "conclusion": "success",
        }
        self.manifest = {
            "schema_version": 1,
            "repository": REPOSITORY,
            "environment": "stage",
            "source": {"branch": "release/1.2.0", "commit": SOURCE_COMMIT, "tree": SOURCE_TREE},
            "build": {"run_id": 100, "attempt": 1, "workflow": release.WORKFLOW_PATH},
            "image": {"repository": f"ghcr.io/{REPOSITORY}", "digest": DIGEST},
        }
        self.source = {"sha": SOURCE_COMMIT, "commit": {"tree": {"sha": SOURCE_TREE}}}
        self.master = {"sha": MASTER_COMMIT, "commit": {"tree": {"sha": SOURCE_TREE}}}
        self.comparison = {"status": "ahead"}
        release.write_json(self.path / "release.json", self.manifest)

    def github(self, path):
        return {
            "actions/runs/100": self.run,
            f"commits/{SOURCE_COMMIT}": self.source,
            "commits/master": self.master,
            f"compare/{SOURCE_COMMIT}...{MASTER_COMMIT}?per_page=1": self.comparison,
        }[path]

    def test_promotion_preserves_digest_and_exports_helm_values(self):
        with patch.object(release, "github", side_effect=self.github):
            release.promote("100", self.path)

        promoted = json.loads((self.path / "production/release.json").read_text())
        values = json.loads((self.path / "production/image-values.yaml").read_text())
        self.assertEqual(promoted["image"], self.manifest["image"])
        self.assertEqual(promoted["environment"], "prod")
        self.assertEqual(promoted["promotion"]["master_commit"], MASTER_COMMIT)
        self.assertEqual(values, {"image": self.manifest["image"]})
        self.assertIn(f"image=ghcr.io/{REPOSITORY}@{DIGEST}\n", (self.path / "outputs").read_text())

    def test_only_successful_release_push_from_expected_workflow_can_be_promoted(self):
        for property_name, value in [
            ("event", "pull_request"),
            ("head_branch", "development"),
            ("path", ".github/workflows/other.yml"),
            ("status", "in_progress"),
            ("conclusion", "failure"),
            ("repository", {"full_name": "other/repository"}),
        ]:
            with self.subTest(property_name=property_name):
                run = dict(self.run, **{property_name: value})
                with self.assertRaises(ValueError):
                    release.validate_run(run, REPOSITORY)

    def test_manifest_cannot_substitute_another_build_or_image(self):
        changes = [
            ("repository", None, "other/repository"),
            ("schema_version", None, 2),
            ("environment", None, "dev"),
            ("source", "commit", "5" * 40),
            ("source", "branch", "release/other"),
            ("source", "tree", "invalid-tree"),
            ("build", "run_id", 999),
            ("build", "attempt", 2),
            ("build", "workflow", ".github/workflows/other.yml"),
            ("image", "repository", "ghcr.io/other/image"),
            ("image", "digest", "latest"),
        ]
        for parent, key, value in changes:
            with self.subTest(parent=parent, key=key):
                manifest = copy.deepcopy(self.manifest)
                if key is None:
                    manifest[parent] = value
                else:
                    manifest[parent][key] = value
                with self.assertRaises(ValueError):
                    release.validate_manifest(manifest, self.run, REPOSITORY)

    def test_rejects_master_with_untested_changes(self):
        self.master["commit"]["tree"]["sha"] = "6" * 40
        with patch.object(release, "github", side_effect=self.github):
            with self.assertRaisesRegex(ValueError, "differs from tested release"):
                release.verify("100", self.path)
        self.assertFalse((self.path / "production").exists())

    def test_rejects_unmerged_release_even_if_tree_matches(self):
        self.comparison["status"] = "diverged"
        with patch.object(release, "github", side_effect=self.github):
            with self.assertRaisesRegex(ValueError, "has not been merged"):
                release.verify("100", self.path)

    def test_rejects_stale_manual_run(self):
        self.master["sha"] = "7" * 40
        with patch.object(release, "github", side_effect=self.github):
            with self.assertRaisesRegex(ValueError, "master advanced"):
                release.promote("100", self.path)
        self.assertFalse((self.path / "production").exists())

    def test_rejects_manual_run_from_another_branch_before_api_access(self):
        with patch.dict(os.environ, GITHUB_REF="refs/heads/development"):
            with patch.object(release, "github") as api:
                with self.assertRaisesRegex(ValueError, "from master"):
                    release.selected_run("100")
                api.assert_not_called()

    def test_rejects_invalid_run_id_before_api_access(self):
        for run_id in ["../100", "0", "100\n", "abc"]:
            with self.subTest(run_id=run_id), patch.object(release, "github") as api:
                with self.assertRaises(ValueError):
                    release.selected_run(run_id)
                api.assert_not_called()

    def test_record_persists_digest_and_source_for_a_release(self):
        with patch.dict(os.environ, GITHUB_SHA=SOURCE_COMMIT, SOURCE_TREE=SOURCE_TREE, IMAGE_DIGEST=DIGEST):
            release.record(self.path / "record")
        record = json.loads((self.path / "record/release.json").read_text())
        self.assertEqual(record["source"], self.manifest["source"])
        self.assertEqual(record["image"], self.manifest["image"])
        self.assertEqual(record["environment"], "stage")

    def test_back_merge_reuses_existing_pr(self):
        with patch.object(release, "github", side_effect=[
            {"ahead_by": 1}, [{"html_url": "https://github.com/example/pull/1"}]
        ]) as api:
            release.back_merge()
        self.assertEqual(api.call_count, 2)
        self.assertTrue(all(not call.kwargs for call in api.call_args_list))

    def test_back_merge_creates_pr_between_existing_branches(self):
        with patch.object(release, "github", side_effect=[
            {"ahead_by": 1}, [], {"html_url": "https://github.com/example/pull/2"}
        ]) as api:
            release.back_merge()
        request = api.call_args.kwargs
        self.assertEqual(request["method"], "POST")
        self.assertEqual(request["body"]["head"], "master")
        self.assertEqual(request["body"]["base"], "development")

    def test_back_merge_does_not_create_empty_pr(self):
        with patch.object(release, "github", return_value={"ahead_by": 0}) as api:
            release.back_merge()
        api.assert_called_once()


if __name__ == "__main__":
    unittest.main()
