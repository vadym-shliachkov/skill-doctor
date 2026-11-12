import subprocess
from scripts.run_eval import run_eval


def main():
    for i in range(3):
        run_eval(i)
    subprocess.run(["claude", "-p", "improve"])


if __name__ == "__main__":
    main()
