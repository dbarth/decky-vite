"""Evaluates a JavaScript expression in Steam's CEF over its debug port and prints the value as JSON.

Runs on the device: ssh HOST python3 - 'EXPR' [TARGET] < cdp.py
TARGET is the title of a CEF page, SharedJSContext by default.
"""
import json
import os
import socket
import struct
import sys
import urllib.request

PORT = 8080


def connect(title):
    pages = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
    url = next(p["webSocketDebuggerUrl"] for p in pages if p["title"] == title)
    s = socket.create_connection(("127.0.0.1", PORT))
    s.send((f"GET {url.split(str(PORT), 1)[1]} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n").encode())
    head = b""
    while b"\r\n\r\n" not in head:
        head += s.recv(4096)
    return s, head.split(b"\r\n\r\n", 1)[1]


def send(s, message):
    data = json.dumps(message).encode()
    mask = os.urandom(4)
    n = len(data)
    size = bytes([0x80 | n]) if n < 126 else bytes([0xFE]) + struct.pack(">H", n) if n < 65536 else \
        bytes([0xFF]) + struct.pack(">Q", n)
    s.send(bytes([0x81]) + size + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def receive(s, buf):
    def need(n):
        nonlocal buf
        while len(buf) < n:
            buf += s.recv(1 << 20)

    message = b""
    while True:
        need(2)
        fin, n, at = buf[0] & 0x80, buf[1] & 0x7F, 2
        if n == 126:
            need(4)
            n, at = struct.unpack(">H", buf[2:4])[0], 4
        elif n == 127:
            need(10)
            n, at = struct.unpack(">Q", buf[2:10])[0], 10
        need(at + n)
        message += buf[at:at + n]
        buf = buf[at + n:]
        if fin:
            return json.loads(message), buf


def evaluate(expression, title="SharedJSContext"):
    s, buf = connect(title)
    send(s, {"id": 1, "method": "Runtime.evaluate",
             "params": {"expression": expression, "awaitPromise": True, "returnByValue": True}})
    while True:
        reply, buf = receive(s, buf)
        if reply.get("id") == 1:
            result = reply["result"]
            if "exceptionDetails" in result:
                raise RuntimeError(result["exceptionDetails"].get("exception", {}).get("description"))
            return result["result"].get("value")


if __name__ == "__main__":
    print(json.dumps(evaluate(sys.argv[1], *sys.argv[2:])))
