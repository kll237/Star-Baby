import subprocess
import os

os.chdir(r'D:\workBuddy\backend')
with open(r'D:\workBuddy\backend\app.log', 'wb') as f:
    p = subprocess.Popen(
        [r'C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2\node.exe', r'dist\main.js'],
        stdout=f,
        stderr=subprocess.STDOUT,
    )
    print(f'BACKEND_PID={p.pid}', flush=True)
    p.wait()
