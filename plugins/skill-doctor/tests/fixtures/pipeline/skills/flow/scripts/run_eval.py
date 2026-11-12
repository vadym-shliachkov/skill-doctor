import subprocess


def run_eval(i):
    subprocess.run(["python", "cli.py", str(i)])
    return i * 2
