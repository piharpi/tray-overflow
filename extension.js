import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const ROLE = 'tray-overflow';
const TRAY_PREFIX = 'appindicator-';

const OverflowButton = GObject.registerClass(
class OverflowButton extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Tray Overflow', true);
        this._icon = new St.Icon({style_class: 'system-status-icon'});
        this.add_child(this._icon);
        this._ext = ext;
    }

    setExpanded(expanded) {
        // Hidden icons sit left of the chevron: "<" = expand, ">" = collapse
        this._icon.icon_name = expanded ? 'pan-end-symbolic' : 'pan-start-symbolic';
    }

    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_RELEASE ||
            type === Clutter.EventType.TOUCH_END) {
            this._ext.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Dropping an icon on the chevron hides it
    handleDragOver(source) {
        return this._ext.isTray(source)
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.CONTINUE;
    }

    acceptDrop(source) {
        return this._ext.dropOnChevron(source);
    }
});

export default class TrayOverflowExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._attached = new Map();
        this._state = new Map();
        this._dragging = false;
        this._timeoutId = 0;
        this._syncId = 0;

        this._button = new OverflowButton(this);
        Main.panel.addToStatusArea(ROLE, this._button, 0, 'right');

        const box = Main.panel._rightBox;
        this._boxIds = [
            box.connect('child-added', () => this._queueSync()),
            box.connect('child-removed', () => this._queueSync()),
        ];
        this._settings.connectObject(
            'changed', () => this._queueSync(),
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
        for (const [ind, draggable] of this._attached)
            this._detach(ind, draggable);
        this._attached.clear();
        this._state.clear();
        this._button.destroy();
        this._button = null;
        this._settings = null;
    }

    toggle() {
        this._settings.set_boolean('expanded', !this._settings.get_boolean('expanded'));
        this._armTimeout();
    }

    isTray(source) {
        return this._attached.has(source);
    }

    dropOnChevron(source) {
        if (!this.isTray(source))
            return false;
        this._moveBefore(source, this._button.container);
        this._place(source, true);
        return true;
    }

    _dropOnTray(source, target, x) {
        if (!this.isTray(source) || source === target)
            return false;
        const box = Main.panel._rightBox;
        const children = box.get_children();
        const next = children[children.indexOf(target.container) + 1];
        if (x > target.width / 2 && next)
            this._moveBefore(source, next);
        else if (x > target.width / 2)
            box.set_child_at_index(source.container, -1);
        else
            this._moveBefore(source, target.container);
        this._place(source, this._state.get(target) ?? false);
        return true;
    }

    _moveBefore(ind, sibling) {
        const box = Main.panel._rightBox;
        if (ind.container !== sibling)
            box.set_child_below_sibling(ind.container, sibling);
    }

    // Persist the shown/hidden choice and icon order after a drop
    _place(ind, hidden) {
        const key = this._key(ind);
        const hiddenItems = this._settings.get_strv('hidden-items').filter(k => k !== key);
        const shownItems = this._settings.get_strv('shown-items').filter(k => k !== key);
        (hidden ? hiddenItems : shownItems).push(key);

        const current = this._placedTrays().map(i => this._key(i));
        const missing = this._settings.get_strv('order').filter(k => !current.includes(k));

        this._settings.set_strv('hidden-items', hiddenItems);
        this._settings.set_strv('shown-items', shownItems);
        this._settings.set_strv('order', [...new Set([...current, ...missing])]);
    }

    _armTimeout() {
        this._clearTimeout();
        const secs = this._settings.get_int('auto-collapse');
        if (!this._settings.get_boolean('expanded') || this._dragging || secs <= 0)
            return;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
            this._timeoutId = 0;
            this._settings.set_boolean('expanded', false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _setDragging(dragging) {
        this._dragging = dragging;
        this._armTimeout();
        this._queueSync();
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

    _key(ind) {
        try {
            if (ind._indicator)
                return ind._indicator.id || ind._indicator.title || ind.uniqueId;
            if (ind._icon?.wm_class)
                return `legacy:${ind._icon.wm_class}`;
            return ind.uniqueId;
        } catch {
            return ind.uniqueId;
        }
    }

    _attach(ind) {
        const draggable = DND.makeDraggable(ind, {dragActorOpacity: 200});
        ind.getDragActor = () => new Clutter.Clone({
            source: ind, width: ind.width, height: ind.height,
        });
        ind.getDragActorSource = () => ind;
        ind.handleDragOver = source => this.isTray(source) && source !== ind
            ? DND.DragMotionResult.MOVE_DROP
            : DND.DragMotionResult.CONTINUE;
        ind.acceptDrop = (source, actor, x) => this._dropOnTray(source, ind, x);

        draggable.connect('drag-begin', () => {
            // Cancel the pending click/activation from ubuntu-appindicators
            ind._waitDoubleClickPromise?.cancel();
            ind.menu?.close?.();
            this._setDragging(true);
        });
        draggable.connect('drag-end', () => this._setDragging(false));

        ind.connectObject(
            'notify::visible', () => this._queueSync(),
            'destroy', () => {
                this._attached.delete(ind);
                this._state.delete(ind);
            },
            this);
        this._attached.set(ind, draggable);
    }

    _detach(ind, draggable) {
        ind.disconnectObject(this);
        ind.remove_action(draggable._dndGesture);
        delete ind.getDragActor;
        delete ind.getDragActorSource;
        delete ind.handleDragOver;
        delete ind.acceptDrop;
        ind.container.show();
    }

    _placedTrays() {
        const box = Main.panel._rightBox;
        const children = box.get_children();
        return [...this._attached.keys()]
            .filter(ind => ind.container.get_parent() === box)
            .sort((a, b) => children.indexOf(a.container) - children.indexOf(b.container));
    }

    _sync() {
        if (!this._button)
            return;

        for (const [role, ind] of Object.entries(Main.panel.statusArea)) {
            if (role.startsWith(TRAY_PREFIX) && ind?.container && !this._attached.has(ind))
                this._attach(ind);
        }

        // Sort by the dragged order; new (unknown) icons go leftmost
        const order = this._settings.get_strv('order');
        const rank = ind => order.indexOf(this._key(ind));
        const current = this._placedTrays();
        const placed = current
            .map((ind, pos) => ({ind, pos}))
            .sort((a, b) => rank(a.ind) - rank(b.ind) || a.pos - b.pos)
            .map(({ind}) => ind);

        const hiddenItems = new Set(this._settings.get_strv('hidden-items'));
        const shownItems = new Set(this._settings.get_strv('shown-items'));
        const max = this._settings.get_int('max-visible');
        const expanded = this._settings.get_boolean('expanded');

        // Icons never dragged fill the remaining max-visible slots from the right
        let shownCount = placed.filter(i => i.visible && shownItems.has(this._key(i))).length;
        this._state.clear();
        for (const ind of [...placed].reverse()) {
            const key = this._key(ind);
            let hidden = false;
            if (hiddenItems.has(key)) {
                hidden = true;
            } else if (!shownItems.has(key) && ind.visible) {
                hidden = shownCount >= max;
                if (!hidden)
                    shownCount++;
            }
            this._state.set(ind, hidden);
        }

        // Reorder: [hidden...] [chevron] [shown...]
        const box = Main.panel._rightBox;
        const own = this._button.container;
        const sequence = [
            ...placed.filter(i => this._state.get(i)).map(i => i.container),
            own,
            ...placed.filter(i => !this._state.get(i)).map(i => i.container),
        ];
        if (placed.length) {
            const first = placed.reduce((a, b) =>
                box.get_children().indexOf(a.container) < box.get_children().indexOf(b.container) ? a : b);
            box.set_child_below_sibling(own, first.container);
            const base = box.get_children().indexOf(own);
            sequence.forEach((actor, i) => {
                if (box.get_children().indexOf(actor) !== base + i)
                    box.set_child_at_index(actor, base + i);
            });
        }

        const reveal = expanded || this._dragging;
        let anyHidden = false;
        for (const ind of placed) {
            const hidden = this._state.get(ind);
            if (hidden && ind.visible)
                anyHidden = true;
            ind.container.visible = !hidden || reveal;
        }

        this._button.setExpanded(expanded);
        own.visible = anyHidden || this._dragging;
    }
}
