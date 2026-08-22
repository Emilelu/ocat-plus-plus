# -*- coding: utf-8 -*-
"""
OCAT 手机同步服务
通过 ADB 从手机拉取最新数据库，支持 Root 和非 Root 两种方式
"""

import subprocess
import os
import sys
import tempfile
import zlib
import tarfile
import io
from http.server import HTTPServer, BaseHTTPRequestHandler

ADB = r"C:\Program Files\Escrcpy\resources\extra\win\scrcpy\adb.exe"
PHONE_DB = "/data/user/0/com.drakeet.deepocat/databases/SQLite/6a705d26492a195c81b6d4fb.db"
LOCAL_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "OCAT.db")
PORT = 8899


class SyncHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/sync":
            self._handle_sync()
        elif self.path == "/api/ping":
            self._send_json({"status": "ok"})
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_sync(self):
        try:
            result = subprocess.run([ADB, "devices"], capture_output=True, text=True)
            if "\tdevice" not in result.stdout:
                self._send_error("未检测到手机连接，请确保 USB 已连接并开启调试模式")
                return

            # 方法 1: 直接 pull（需要 root）
            print("  📱 方法 1: 尝试直接拉取 (root)...")
            r = subprocess.run(
                [ADB, "pull", PHONE_DB, LOCAL_DB],
                capture_output=True, text=True, timeout=10
            )
            if r.returncode == 0:
                data = self._read_db()
                if data:
                    print("  ✅ 已同步 (root 方式)")
                    self._send_db(data)
                    return

            # 方法 2: run-as（需要 debuggable 应用）
            print("  📱 方法 2: 尝试 run-as...")
            r = subprocess.run(
                [ADB, "exec-out", "run-as", "com.drakeet.deepocat",
                 "cat", "databases/SQLite/6a705d26492a195c81b6d4fb.db"],
                capture_output=True, timeout=10
            )
            if r.returncode == 0 and len(r.stdout) > 1000:
                with open(LOCAL_DB, "wb") as f:
                    f.write(r.stdout)
                print("  ✅ 已同步 (run-as 方式)")
                self._send_db(r.stdout)
                return

            # 方法 3: adb backup（通用，需手机确认）
            print("  📱 方法 3: 尝试 adb backup（请在手机上点击「备份我的数据」）...")
            with tempfile.NamedTemporaryFile(suffix=".ab", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                r = subprocess.run(
                    [ADB, "backup", "-f", tmp_path, "-noapk",
                     "com.drakeet.deepocat"],
                    capture_output=True, text=True, timeout=60
                )
                if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 100:
                    data = self._extract_backup(tmp_path)
                    if data:
                        with open(LOCAL_DB, "wb") as f:
                            f.write(data)
                        print("  ✅ 已同步 (backup 方式)")
                        self._send_db(data)
                        return
                self._send_error("adb backup 失败，请在手机上确认备份操作")
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)

        except subprocess.TimeoutExpired:
            self._send_error("ADB 操作超时，请重试")
        except Exception as e:
            self._send_error(str(e))

    def _read_db(self):
        if os.path.exists(LOCAL_DB) and os.path.getsize(LOCAL_DB) > 1000:
            with open(LOCAL_DB, "rb") as f:
                return f.read()
        return None

    def _send_db(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _extract_backup(self, ab_path):
        """从 Android Backup (.ab) 文件中提取数据库"""
        try:
            with open(ab_path, "rb") as f:
                # 跳过 24 字节 AB 头部
                header = f.read(24)
                if len(header) < 24:
                    return None
                compressed = header[4:5] == b"\x01"
                data = f.read()

            if compressed:
                data = zlib.decompress(data)

            # 解析 tar
            with tarfile.open(fileobj=io.BytesIO(data)) as tar:
                for member in tar.getmembers():
                    if "6a705d26492a195c81b6d4fb.db" in member.name:
                        return tar.extractfile(member).read()
            return None
        except Exception:
            return None

    def _send_json(self, data):
        import json
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg):
        import json
        body = json.dumps({"error": msg}).encode()
        self.send_response(500)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f"  ❌ {msg}")

    def log_message(self, format, *args):
        pass


def main():
    if not os.path.exists(ADB):
        print(f"错误: ADB 未找到: {ADB}")
        sys.exit(1)

    server = HTTPServer(("127.0.0.1", PORT), SyncHandler)
    print(f"\n  📱 OCAT 同步服务已启动")
    print(f"  🌐 http://localhost:{PORT}/api/sync")
    print(f"  📂 目标: {LOCAL_DB}")
    print(f"\n  支持三种同步方式:")
    print(f"    1. Root: 直接 pull")
    print(f"    2. Debuggable: run-as")
    print(f"    3. 通用: adb backup (需在手机上确认)")
    print(f"\n  保持此窗口运行，在浏览器中点击「同步手机」即可")
    print(f"  按 Ctrl+C 停止\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止")
        server.server_close()


if __name__ == "__main__":
    main()