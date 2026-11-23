set -e
make up
make ps | tee /dev/stderr | grep -c healthy | grep -q 2
python3 -c "import socket;s=socket.create_connection(('127.0.0.1',6379),5);s.sendall(b'PING\\r\\n');assert s.recv(7)==b'+PONG\\r\\n'"
python3 -c "import socket;s=socket.create_connection(('127.0.0.1',5432),5);s.sendall(bytes([0,0,0,8,4,210,22,47]));assert s.recv(1) in (b'N',b'S')"
test -f .env.example && grep -q '^AUTO_PUBLISH=true' .env.example
ls wiki-sample/*/*.md | wc -l | awk '{exit !($1>=3)}'
