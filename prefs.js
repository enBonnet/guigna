import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/shell/extensions/extension.js';

const ANIMATIONS = [
    ['fade', 'Fade'],
    ['left-right', 'Slide left to right'],
    ['right-left', 'Slide right to left'],
    ['top-bottom', 'Slide top to bottom'],
    ['bottom-top', 'Slide bottom to top'],
];

export default class WorldClocksCarouselPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'World Clocks Carousel',
            icon_name: 'preferences-system-time-symbolic',
        });

        const animationGroup = new Adw.PreferencesGroup({
            title: 'Animation',
            description: 'Transition used when switching between clocks',
        });
        page.add(animationGroup);

        const model = new Gtk.StringList();
        for (const [, label] of ANIMATIONS)
            model.append(label);
        const combo = new Adw.ComboRow({ title: 'Style', model });
        const initial = ANIMATIONS.findIndex(
            ([id]) => id === settings.get_string('animation'));
        combo.set_selected(initial === -1 ? 0 : initial);
        combo.connect('notify::selected', () => {
            const [id] = ANIMATIONS[combo.selected];
            settings.set_string('animation', id);
        });
        settings.connect('changed::animation', () => {
            const idx = ANIMATIONS.findIndex(
                ([id]) => id === settings.get_string('animation'));
            if (idx !== -1 && idx !== combo.selected)
                combo.set_selected(idx);
        });
        animationGroup.add(combo);

        const positionGroup = new Adw.PreferencesGroup({
            title: 'Panel position',
            description: 'Where the indicator sits in the top bar',
        });
        page.add(positionGroup);

        const row = new Adw.ActionRow({
            title: 'Position',
            subtitle: 'End of the panel',
        });
        const left = new Gtk.Button({
            icon_name: 'pan-start-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Move left',
        });
        const right = new Gtk.Button({
            icon_name: 'pan-end-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Move right',
        });
        left.connect('clicked', () => {
            const current = settings.get_int('position');
            settings.set_int('position', current <= 0 ? 0 : current - 1);
        });
        right.connect('clicked', () => {
            const current = settings.get_int('position');
            settings.set_int('position', current < 0 ? current : current + 1);
        });
        row.add_prefix(left);
        row.add_suffix(right);
        settings.connect('changed::position', () => {
            const current = settings.get_int('position');
            row.subtitle = current < 0
                ? 'End of the panel'
                : `Slot ${current + 1} from the left`;
        });
        positionGroup.add(row);

        window.add(page);
    }
}
