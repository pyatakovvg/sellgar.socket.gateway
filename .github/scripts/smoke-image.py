#!/usr/bin/env python3
"""Smoke a production image using isolated dependencies and mounted .env."""
import json
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request
import uuid

image = sys.argv[1]
kind = 'socket'
port = 8080
network = 'gateway-smoke-' + uuid.uuid4().hex[:10]
containers = []

def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()

def start(name, *args):
    containers.append(name)
    docker('run', '-d', '--name', name, '--network', network, *args)

def wait(name, *command):
    for _ in range(60):
        if subprocess.run(['docker', 'exec', name, *command], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return
        time.sleep(1)
    raise RuntimeError(f'{name} startup timeout')

try:
    docker('network', 'create', network)
    broker = network + '-broker'
    start(broker, '--user', '999:999', '--tmpfs', '/var/lib/rabbitmq:uid=999,gid=999,mode=0700', '--network-alias', 'broker', '-e', 'RABBITMQ_DEFAULT_USER=smoke', '-e', 'RABBITMQ_DEFAULT_PASS=smoke',
          'rabbitmq:4.4.1-management@sha256:61f90c401a5b5ed2486771973ea92ad66046471eacab9c9149f1a6e091c91677')
    wait(broker, 'rabbitmq-diagnostics', '-q', 'ping')
    values = {}
    for line in pathlib.Path('code/.env.example').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value.strip().strip('"')
    values.update(PORT=str(port), AMQP_HOSTNAME='broker', AMQP_USERNAME='smoke', AMQP_PASSWORD='smoke', ORIGINS='http://localhost',
                  SOCKET_TICKET_SECRET='isolated-smoke-secret-not-used-in-any-environment',
                  STOREFRONT_SHOP_UUID='a7bded5f-24ee-4d2a-b13f-2436f4f5337f')
    if kind == 'socket':
        db = network + '-db'
        start(db, '--network-alias', 'database', '-e', 'POSTGRES_USER=socket_srv', '-e', 'POSTGRES_PASSWORD=smoke',
              '-e', 'POSTGRES_DB=socket_srv', 'postgres:16-bookworm')
        wait(db, 'pg_isready', '-U', 'socket_srv')
        values.update(DATABASE_HOST='database', DATABASE_PORT='5432', DATABASE_USERNAME='socket_srv', DATABASE_PASSWORD='smoke', DATABASE_DATABASE_NAME='socket_srv')
    with tempfile.TemporaryDirectory() as directory:
        env = pathlib.Path(directory) / '.env'
        env.write_text(''.join(f'{key}={value}\n' for key, value in values.items()))
        env.chmod(0o644)
        mount = ['--mount', f'type=bind,src={env},dst=/app/.env,readonly']
        if kind == 'socket':
            print(docker('run', '--rm', '--network', network, *mount, image, 'node', '--env-file=.env',
                         'node_modules/typeorm/cli.js', '-d', 'dist/data-source.js', 'migration:run'))
        app = network + '-app'
        start(app, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--tmpfs', '/tmp',
              '-p', f'127.0.0.1::{port}', *mount, image)
        host_port = json.loads(docker('inspect', app))[0]['NetworkSettings']['Ports'][f'{port}/tcp'][0]['HostPort']
        for _ in range(90):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{host_port}/health', timeout=2) as response:
                    if json.load(response)['status'] == 'ok':
                        break
            except (OSError, ValueError):
                pass
            if docker('inspect', '--format', '{{.State.Running}}', app) != 'true':
                raise RuntimeError('Gateway exited during startup')
            time.sleep(1)
        else:
            raise RuntimeError('Gateway health timeout')
        assert docker('exec', app, 'id', '-u') == '1000'
        print(f'{kind}: image, mounted .env, dependencies and non-root health passed')
except Exception:
    for name in containers:
        subprocess.run(['docker', 'logs', '--tail', '30', name], check=False)
    raise
finally:
    for name in reversed(containers):
        subprocess.run(['docker', 'rm', '-f', '-v', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['docker', 'network', 'rm', network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
