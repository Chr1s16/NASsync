# NAS Sync ⇄

A lightweight, self-hosted Docker app with a web GUI for manually syncing folders between your NAS and an external HDD — powered by rsync.

![Status](https://img.shields.io/badge/docker-ready-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Web GUI** — accessible from any browser on your local network
- **Multiple sync jobs** — create, name, and manage as many jobs as you need
- **Live terminal output** — watch rsync run in real time with speed and file stats
- **Safe eject indicator** — green banner when sync is complete, safe to unplug
- **Persistent jobs** — jobs survive container restarts
- **rsync options** — `--delete`, `--checksum`, `--dry-run` per job
- **Multi-arch** — runs on x86 NAS devices and ARM (Raspberry Pi, Synology ARM, etc.)

---

## Quick Start

### Option A — Pull from GitHub Container Registry (recommended)

**1. Download the compose file**
```bash
curl -O https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/nassync/main/docker-compose.yml
```

**2. Edit `docker-compose.yml`** — set your NAS source and HDD destination paths:
```yaml
volumes:
  - nassync_data:/data
  - /path/to/nas/folder:/nas/folder:ro   # your NAS source
  - /path/to/external/hdd:/hdd           # your external HDD
```

> If your path has **spaces**, use the long-form bind syntax (see comments in the file).

**3. Start it**
```bash
docker compose up -d
```

**4. Open the GUI**
```
http://<your-nas-ip>:3000
```

---

### Option B — Build locally

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/nassync.git
cd nassync
# edit docker-compose.build.yml with your paths
docker compose -f docker-compose.build.yml up -d --build
```

---

## Usage

1. Click **+ New Job** in the sidebar
2. Enter a name, source path (as seen inside the container), and destination path
3. Pick options:
   - **`--delete`** — remove files on destination that no longer exist on source
   - **`--checksum`** — verify by file content instead of size/mtime *(slow on large libraries)*
   - **`--dry-run`** — simulate without copying anything — always test first!
4. Hit **▶ Start Sync** and watch the live output
5. When the green **"Sync complete — safe to eject"** banner appears, you're done
6. Unmount and unplug your drive

---

## Safe Eject

After the sync completes, unmount the drive on the host before unplugging:

```bash
sudo umount /path/to/external/hdd
# or
sudo eject /dev/sdX
```

---

## Path Mapping

Paths in the GUI refer to paths **inside the container**, not the host. Map them in `docker-compose.yml`:

| Host path | Container path | Use in GUI |
|---|---|---|
| `/mnt/nas/photos` | `/nas/photos` | `/nas/photos` |
| `/media/Seagate 4TB/Backup` | `/hdd/backup` | `/hdd/backup` |

---

## Notes for ZimaOS / Read-only root filesystems

If `docker compose up -d` silently fails due to a read-only root filesystem, run with:

```bash
sudo DOCKER_CONFIG=/path/to/writable/dir docker compose up -d
```

---

## License

MIT
