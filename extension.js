import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Popup from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ANIMATIONS, normalizeAnimation, isAppendPosition }
    from './constants.js';

const ROTATION_SECONDS = 5;
const FADE_MS = 150;

function flagForCountry(code) {
    if (!code || code.length !== 2)
        return null;
    const upper = code.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper))
        return null;
    return String.fromCodePoint(
        ...[...upper].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// GLib >= 2.86 returns microseconds, older versions seconds. Real offsets
// never exceed +/-15h, so the magnitude tells the unit apart.
function offsetToSeconds(raw) {
    return Math.abs(raw) > 1e6 ? raw / 1e6 : raw;
}

function formatDiff(diffMinutes) {
    if (diffMinutes === 0)
        return null;
    const sign = diffMinutes > 0 ? '+' : '-';
    const abs = Math.abs(diffMinutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    let body;
    if (m === 0)
        body = `${h}h`;
    else if (m === 15)
        body = `${h}¼h`;
    else if (m === 30)
        body = `${h}½h`;
    else if (m === 45)
        body = `${h}¾h`;
    else
        body = `${h}:${m.toString().padStart(2, '0')}h`;
    return sign + body;
}

export default class WorldClocksCarouselExtension extends Extension {
    enable() {
        this._clocks = [];
        this._index = 0;
        this._rotationId = 0;
        this._minuteId = 0;
        this._clickedId = 0;
        this._scrollId = 0;
        this._enterId = 0;
        this._leaveId = 0;
        this._clocksChangedId = 0;
        this._formatChangedId = 0;
        this._animationChangedId = 0;
        this._positionChangedId = 0;

        // GNOME Clocks provides the world clocks; without it there is nothing
        // to show. Degrade to a no-op instead of failing to load. disable()
        // already tolerates this partial init (every cleanup is id/guarded).
        if (!Gio.SettingsSchemaSource.get_default().lookup('org.gnome.clocks', true)) {
            console.warn(`${this.metadata.uuid}: GNOME Clocks is not installed — nothing to show`);
            return;
        }
        this._clocksSettings = new Gio.Settings({ schema_id: 'org.gnome.clocks' });
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._settings = this.getSettings();
        this._migrateLegacyState();

        this._label = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
        this._button = new St.Button({
            style_class: 'panel-button',
            style: 'padding: 4px 12px;',
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._button.set_child(this._label);
        this._button.hide();
        this._tooltip = null;

        this._clickedId = this._button.connect('clicked', () => {
            this._hideTooltip();
            this._menu.toggle();
        });
        this._scrollId = this._button.connect('scroll-event', (a, event) => {
            const dir = event.get_scroll_direction();
            if (dir === Clutter.ScrollDirection.DOWN)
                this._step(1);
            else if (dir === Clutter.ScrollDirection.UP)
                this._step(-1);
            else
                return Clutter.EVENT_PROPAGATE;
            this._startRotation();
            return Clutter.EVENT_STOP;
        });
        this._enterId = this._button.connect('enter-event', () => this._showTooltip());
        this._leaveId = this._button.connect('leave-event', () => this._hideTooltip());

        this._menuManager = new Popup.PopupMenuManager(this._button);
        this._menu = new Popup.PopupMenu(this._button, 0, St.Side.TOP);
        this._menu.addAction('Next clock', () => {
            this._step(1);
            this._startRotation();
        });
        this._menu.addMenuItem(new Popup.PopupSeparatorMenuItem());
        this._menu.addAction('Move left', () => this._moveBy(-1));
        this._menu.addAction('Move right', () => this._moveBy(1));

        this._animationItems = {};
        const animationItem = new Popup.PopupSubMenuMenuItem('Animation');
        for (const [id, label] of ANIMATIONS) {
            const item = animationItem.menu.addAction(label, () => this._setAnimation(id));
            item.setOrnament(Popup.Ornament.NONE);
            this._animationItems[id] = item;
        }
        this._menu.addMenuItem(animationItem);
        this._menu.addAction('Preferences', () => this.openPreferences());
        this._menuManager.addMenu(this._menu);
        // GNOME Shell 50's PopupMenuManager no longer parents menu actors, so
        // the menu must be added to the UI group explicitly. Harmless on older
        // shells, where addMenu() already did it.
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();

        this._box = Main.panel._leftBox ?? Main.panel;
        this._animation = normalizeAnimation(this._settings.get_string('animation'));
        this._syncAnimationOrnaments();
        const position = this._settings.get_int('position');
        if (isAppendPosition(position))
            this._box.add_child(this._button);
        else
            this._box.insert_child_at_index(
                this._button, Math.min(position, this._box.get_n_children()));

        this._animationChangedId = this._settings.connect(
            'changed::animation', () => this._onAnimationChanged());
        this._positionChangedId = this._settings.connect(
            'changed::position', () => this._onPositionChanged());

        this._clocksChangedId = this._clocksSettings.connect(
            'changed::world-clocks', () => this._reloadClocks());
        this._formatChangedId = this._interfaceSettings.connect(
            'changed::clock-format', () => this._updateLabel(false));

        this._reloadClocks();
    }

    disable() {
        this._stopRotation();
        this._cancelMinuteUpdate();

        if (this._clocksChangedId) {
            this._clocksSettings.disconnect(this._clocksChangedId);
            this._clocksChangedId = 0;
        }
        this._clocksSettings = null;
        if (this._formatChangedId) {
            this._interfaceSettings.disconnect(this._formatChangedId);
            this._formatChangedId = 0;
        }
        this._interfaceSettings = null;
        if (this._animationChangedId) {
            this._settings.disconnect(this._animationChangedId);
            this._animationChangedId = 0;
        }
        if (this._positionChangedId) {
            this._settings.disconnect(this._positionChangedId);
            this._positionChangedId = 0;
        }
        this._settings = null;

        if (this._tooltip) {
            Main.layoutManager.removeChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
        if (this._menu) {
            this._menu.destroy();
            this._menu = null;
        }
        this._menuManager = null;
        // The label is the button's child; destroy it first so the actor is
        // not already disposed when we tear down the button below.
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        if (this._button) {
            if (this._clickedId) {
                this._button.disconnect(this._clickedId);
                this._clickedId = 0;
            }
            if (this._scrollId) {
                this._button.disconnect(this._scrollId);
                this._scrollId = 0;
            }
            if (this._enterId) {
                this._button.disconnect(this._enterId);
                this._enterId = 0;
            }
            if (this._leaveId) {
                this._button.disconnect(this._leaveId);
                this._leaveId = 0;
            }
            this._button.destroy();
            this._button = null;
        }
        this._box = null;
        this._clocks = [];
        this._index = 0;
        this._animationItems = {};
        this._animation = 'fade';
    }

    _migrateLegacyState() {
        // `state-migrated` is flagged *before* the import attempt on purpose:
        // a corrupt or unreadable legacy file must not retry on every enable.
        // One-shot migration wins over eventual recovery.
        if (this._settings.get_boolean('state-migrated'))
            return;
        this._settings.set_boolean('state-migrated', true);
        const path = GLib.build_filenamev(
            [GLib.get_user_config_dir(), `${this.metadata.uuid}.json`]);
        Gio.File.new_for_path(path).load_contents_async(null, (src, res) => {
            try {
                const [ok, contents] = src.load_contents_finish(res);
                // disable() may have run while the read was in flight.
                if (!ok || !this._settings)
                    return;
                const state = JSON.parse(new TextDecoder().decode(contents));
                if (Number.isInteger(state.position) && state.position >= 0)
                    this._settings.set_int('position', state.position);
                if (normalizeAnimation(state.animation) === state.animation)
                    this._settings.set_string('animation', state.animation);
            } catch (e) {
                console.warn(`${this.metadata.uuid}: legacy state not imported: ${e}`);
            }
        });
    }

    _onAnimationChanged() {
        if (!this._settings)
            return;
        this._animation = normalizeAnimation(this._settings.get_string('animation'));
        this._syncAnimationOrnaments();
        if (this._clocks.length)
            this._updateLabel(true);
    }

    _onPositionChanged() {
        if (!this._box || !this._button || !this._settings)
            return;
        const target = this._settings.get_int('position');
        const children = this._box.get_children();
        const i = children.indexOf(this._button);
        if (i === -1)
            return;
        // Clamp out-of-range values and write the clamped index back. Writing
        // a key we observe re-enters this handler once; the `j === i` early
        // return keeps that pass a no-op.
        const j = isAppendPosition(target) || target >= children.length
            ? children.length - 1
            : target;
        if (j !== target)
            this._settings.set_int('position', j);
        if (j === i)
            return;
        this._box.remove_child(this._button);
        this._box.insert_child_at_index(this._button, j);
    }

    _setAnimation(id) {
        if (normalizeAnimation(id) !== id)
            return;
        this._settings.set_string('animation', id);
    }

    _syncAnimationOrnaments() {
        for (const [id] of ANIMATIONS) {
            const item = this._animationItems[id];
            if (item)
                item.setOrnament(
                    id === this._animation ? Popup.Ornament.DOT : Popup.Ornament.NONE);
        }
    }

    _moveBy(step) {
        if (!this._box || !this._button)
            return;
        const children = this._box.get_children();
        const i = children.indexOf(this._button);
        if (i === -1)
            return;
        const j = Math.max(0, Math.min(children.length - 1, i + step));
        if (j === i)
            return;
        this._settings.set_int('position', j);
    }

    _reloadClocks() {
        const clocks = [];
        try {
            const value = this._clocksSettings.get_value('world-clocks');
            const world = GWeather.Location.get_world();
            for (let i = 0; i < value.n_children(); i++) {
                const locVar = value.get_child_value(i).lookup_value('location', null);
                if (!locVar || !world)
                    continue;
                const location = world.deserialize(locVar);
                const tzId = location.get_timezone_str();
                if (!tzId)
                    continue;
                clocks.push({
                    name: location.get_name() ?? '',
                    countryName: location.get_country_name() ?? '',
                    countryCode: location.get_country() ?? null,
                    tz: GLib.TimeZone.new(tzId),
                });
            }
        } catch (e) {
            console.error(`${this.metadata.uuid}: failed to load world clocks: ${e}`);
        }

        this._clocks = clocks;
        this._index = clocks.length
            ? Math.min(this._index, clocks.length - 1)
            : 0;
        this._button.visible = clocks.length > 0;

        if (!clocks.length) {
            this._stopRotation();
            this._cancelMinuteUpdate();
            this._hideTooltip();
            return;
        }

        this._updateLabel(false);
        this._startRotation();
        this._scheduleMinuteUpdate();
    }

    _formatCurrent() {
        const clock = this._clocks[this._index];
        const nowCity = GLib.DateTime.new_now(clock.tz);
        const nowLocal = GLib.DateTime.new_now_local();
        const diffMinutes = Math.round(
            (offsetToSeconds(nowCity.get_utc_offset()) -
             offsetToSeconds(nowLocal.get_utc_offset())) / 60);

        const use12h = this._interfaceSettings.get_string('clock-format') === '12h';
        const time = nowCity.format(use12h ? '%l:%M %p' : '%H:%M').trim();
        const flag = flagForCountry(clock.countryCode);

        const parts = [];
        if (flag)
            parts.push(flag);
        if (clock.name)
            parts.push(clock.name);
        parts.push(time);
        const diff = formatDiff(diffMinutes);
        if (diff)
            parts.push(diff);
        return parts.join(' ');
    }

    _tooltipText() {
        const clock = this._clocks[this._index];
        const place = clock.countryName
            ? `${clock.name} — ${clock.countryName}`
            : clock.name;
        return place;
    }

    _updateLabel(animate) {
        if (!this._label)
            return;
        const apply = () => {
            if (!this._label)
                return;
            this._label.text = this._formatCurrent();
            this._updateTooltipText();
        };
        if (!animate) {
            apply();
            return;
        }
        if (this._animation === 'fade') {
            this._label.ease({
                opacity: 0,
                duration: FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    apply();
                    if (!this._label)
                        return;
                    this._label.ease({
                        opacity: 255,
                        duration: FADE_MS,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    });
                },
            });
            return;
        }
        const [dx, dy] = this._slideOffset();
        this._label.ease({
            translation_x: -dx,
            translation_y: -dy,
            opacity: 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                apply();
                if (!this._label)
                    return;
                this._label.translation_x = dx;
                this._label.translation_y = dy;
                this._label.ease({
                    translation_x: 0,
                    translation_y: 0,
                    opacity: 255,
                    duration: FADE_MS,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            },
        });
    }

    _slideOffset() {
        switch (this._animation) {
        case 'left-right':
            return [-this._label.width, 0];
        case 'right-left':
            return [this._label.width, 0];
        case 'top-bottom':
            return [0, -this._label.height];
        case 'bottom-top':
            return [0, this._label.height];
        default:
            return [0, 0];
        }
    }

    _step(step) {
        const n = this._clocks.length;
        if (n === 0)
            return;
        this._index = (this._index + step + n) % n;
        this._updateLabel(true);
    }

    _startRotation() {
        this._stopRotation();
        if (this._clocks.length < 2)
            return;
        this._rotationId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, ROTATION_SECONDS, () => {
                this._step(1);
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopRotation() {
        if (this._rotationId) {
            GLib.source_remove(this._rotationId);
            this._rotationId = 0;
        }
    }

    _scheduleMinuteUpdate() {
        this._cancelMinuteUpdate();
        const now = GLib.DateTime.new_now_local();
        const wait = Math.max(1, 60 - Math.floor(now.get_seconds()));
        this._minuteId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, wait, () => {
                this._minuteId = 0;
                if (this._clocks.length)
                    this._updateLabel(false);
                this._scheduleMinuteUpdate();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelMinuteUpdate() {
        if (this._minuteId) {
            GLib.source_remove(this._minuteId);
            this._minuteId = 0;
        }
    }

    _ensureTooltip() {
        if (this._tooltip)
            return;
        this._tooltip = new St.Label({
            style: 'background-color: rgba(29, 29, 29, 0.96); color: #eeeeec;' +
                   'padding: 6px 12px; border-radius: 12px; font-weight: 500;',
            opacity: 0,
            visible: false,
        });
        Main.layoutManager.addChrome(this._tooltip, { affectsInputRegion: false });
    }

    _showTooltip() {
        if (!this._button || this._clocks.length === 0)
            return;
        this._ensureTooltip();
        this._tooltip.text = this._tooltipText();
        this._tooltip.visible = true;
        this._tooltip.opacity = 0;

        const [, natW] = this._tooltip.get_preferred_width(-1);
        const [, natH] = this._tooltip.get_preferred_height(natW);
        const monitor = Main.layoutManager.primaryMonitor;
        const [bx] = this._button.get_transformed_position();
        const bw = this._button.width;

        let x = bx + bw / 2 - natW / 2;
        x = Math.max(monitor.x + 8, Math.min(x, monitor.x + monitor.width - natW - 8));
        this._tooltip.set_position(Math.round(x), (Main.panel?.height ?? 32) + 8);

        this._tooltip.ease({
            opacity: 255,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _updateTooltipText() {
        if (this._tooltip && this._tooltip.visible && this._clocks.length)
            this._tooltip.text = this._tooltipText();
    }

    _hideTooltip() {
        if (!this._tooltip || !this._tooltip.visible)
            return;
        this._tooltip.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._tooltip)
                    this._tooltip.visible = false;
            },
        });
    }
}
