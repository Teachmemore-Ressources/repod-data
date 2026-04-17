import subprocess

def add_package(file_name):
    cmd = f"docker exec depot-apt /add-deb.sh"
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return {"message": f"{file_name} ajouté au dépôt", "logs": result.stdout}
