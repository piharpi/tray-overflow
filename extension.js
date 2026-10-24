import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const ROLE = 'tray-overflow';
const TRAY_PREFIX = 'appindicator-';

const OverflowButton = GObject.registerClass(
class OverflowButton extends PanelMenu.Button {
    _init(onToggle) {
        super._init(0.5, 'Tray Overflow', true);
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._onToggle = onToggle;
    }

    setExpanded(expanded) {
        // Ikon tersembunyi ada di kiri chevron: "<" = buka, ">" = tutup
        this._icon.icon_name = expanded ? 'pan-end-symbolic' : 'pan-start-symbolic';
    }

    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_RELEASE ||
            type === Clutter.EventType.TOUCH_END) {
            this._onToggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

export default class TrayOverflowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._hidden = new Set();
        this._watched = new Set();
        this._timeoutId = 0;
        this._syncId = 0;

        this._button = new OverflowButton(() => this._toggle());
        Main.panel.addToStatusArea(ROLE, this._button, 0, 'right');

        const box = Main.panel._rightBox;
        this._boxIds = [
            box.connect('child-added', () => this._queueSync()),
            box.connect('child-removed', () => this._queueSync()),
        ];
        this._settings.connectObject(
            'changed::max-visible', () => this._queueSync(),
            'changed::expanded', () => this._queueSync(),
            this);

        this._sync();
    }

    disable() {
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._clearTimeout();
        const box = Main.panel._rightBox;
        this._boxIds.forEach(id => box.disconnect(id));
        this._settings.disconnectObject(this);
        for (const indicator of this._watched)
            indicator.disconnectObject(this);
        this._watched.clear();
        for (const container of this._hidden)
            container.show();
        this._hidden.clear();
        this._button.destroy();
        this._button = null;
        this._settings = null;
    }

    _toggle() {
        const expanded = !this._settings.get_boolean('expanded');
        this._settings.set_boolean('expanded', expanded);
        this._clearTimeout();
        const secs = this._settings.get_int('auto-collapse');
        if (expanded && secs > 0) {
            this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
                this._timeoutId = 0;
                this._settings.set_boolean('expanded', false);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _trayIndicators() {
        return Object.entries(Main.panel.statusArea)
            .filter(([role, ind]) => role.startsWith(TRAY_PREFIX) && ind?.container)
            .map(([, ind]) => ind);
    }

    _sync() {
        if (!this._button)
            return;

        const box = Main.panel._rightBox;
        const trays = this._trayIndicators();

        // Pantau ikon yang muncul/hilang (status Passive/Active)
        for (const ind of trays) {
            if (!this._watched.has(ind)) {
                ind.connectObject(
                    'notify::visible', () => this._queueSync(),
                    'destroy', () => this._watched.delete(ind),
                    this);
                this._watched.add(ind);
            }
        }

        // Urutkan sesuai posisi di panel, kanan ke kiri
        const children = box.get_children();
        const active = trays
            .filter(ind => ind.visible && ind.container.get_parent() === box)
            .sort((a, b) => children.indexOf(b.container) - children.indexOf(a.container));

        const max = this._settings.get_int('max-visible');
        const expanded = this._settings.get_boolean('expanded');
        const overflow = active.slice(max);
        const overflowing = overflow.length > 0;

        for (const container of this._hidden)
            container.show();
        this._hidden.clear();

        if (!expanded) {
            for (const ind of overflow) {
                ind.container.hide();
                this._hidden.add(ind.container);
            }
        }

        // Taruh chevron tepat di kiri ikon terakhir yang selalu tampil
        const ownContainer = this._button.container;
        const anchor = active[Math.min(max, active.length) - 1];
        if (overflowing && anchor) {
            const idx = box.get_children().indexOf(anchor.container);
            const cur = box.get_children().indexOf(ownContainer);
            const target = cur < idx ? idx - 1 : idx;
            if (cur !== target)
                box.set_child_at_index(ownContainer, target);
        }

        this._button.setExpanded(expanded);
        ownContainer.visible = overflowing;
    }
}
