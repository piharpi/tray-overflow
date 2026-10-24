# Tray Overflow

GNOME Shell extension that collapses extra tray icons (AppIndicator / KStatusNotifierItem) behind a chevron button in the top bar.

| Collapsed | Expanded |
| --- | --- |
| ![Collapsed: extra tray icons hidden behind the chevron](screenshots/collapsed.png) | ![Expanded: hidden icons revealed to the left of the chevron](screenshots/expanded.png) |

- The rightmost *N* tray icons stay visible (default 3). The rest are hidden behind `‹`.
- Click the chevron to expand or collapse. Expanded icons collapse again automatically after a timeout (default 10 s).
- The chevron only appears when there are hidden icons. Hidden (passive) indicators are not counted.
- **Drag & drop** an icon to choose where it lives: drop it on the chevron (or on a hidden icon) to hide it, drop it on a visible icon to keep it shown. Its position and choice are remembered per app. While dragging, all hidden icons are revealed.
- Icons you never dragged fill the remaining *N* visible slots automatically.

Requires the [AppIndicator support](https://github.com/ubuntu/gnome-shell-extension-appindicator) extension (`ubuntu-appindicators@ubuntu.com` on Ubuntu). GNOME Shell 50.

## Install

```bash
git clone https://github.com/piharpi/tray-overflow ~/.local/share/gnome-shell/extensions/tray-overflow@harpi
glib-compile-schemas ~/.local/share/gnome-shell/extensions/tray-overflow@harpi/schemas
# log out and back in (Wayland), then:
gnome-extensions enable tray-overflow@harpi
```

## Settings

```bash
S=~/.local/share/gnome-shell/extensions/tray-overflow@harpi/schemas
gsettings --schemadir $S set org.gnome.shell.extensions.tray-overflow max-visible 4   # icons always shown
gsettings --schemadir $S set org.gnome.shell.extensions.tray-overflow auto-collapse 0 # seconds, 0 = never
# forget drag & drop choices
for k in hidden-items shown-items order; do gsettings --schemadir $S reset org.gnome.shell.extensions.tray-overflow $k; done
```

## Tested on

| | |
| --- | --- |
| Device | Lenovo ThinkPad E14 Gen 7 (21SX) |
| CPU | Intel Core Ultra 7 255H (16 threads) |
| GPU | Intel Arc Graphics (Arrow Lake-P, integrated) |
| RAM | 32 GB (29.8 GiB usable) |
| OS | Ubuntu 26.04.1 LTS, kernel 7.0.0-38-generic |
| Desktop | GNOME Shell 50.1, Wayland session |
| Tray support | `ubuntu-appindicators@ubuntu.com` (gnome-shell-ubuntu-extensions 50.26.04.8ubuntu) |

## License

GPL-2.0-or-later
