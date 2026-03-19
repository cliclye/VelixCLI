export var Keybind;
(function (Keybind) {
    function parse(value) {
        if (!value || value === "none")
            return [];
        const info = { name: "" };
        const lower = value.toLowerCase();
        // Handle space-separated chord: "ctrl+x c" -> parse as one sequence
        // We just parse the simple single keybind for now
        const parts = lower.split("+");
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed === "ctrl")
                info.ctrl = true;
            else if (trimmed === "meta" || trimmed === "alt")
                info.meta = true;
            else if (trimmed === "shift")
                info.shift = true;
            else if (trimmed === "super")
                info.super = true;
            else if (trimmed === "<leader>" || trimmed === "leader")
                info.leader = true;
            else if (trimmed)
                info.name = trimmed;
        }
        if (!info.name)
            return [];
        return [info];
    }
    Keybind.parse = parse;
    function fromParsedKey(evt, leader) {
        return {
            name: evt.name,
            ctrl: evt.ctrl || undefined,
            meta: evt.meta || undefined,
            alt: evt.alt || undefined,
            shift: evt.shift || undefined,
            super: evt.super || undefined,
            leader: leader || undefined,
        };
    }
    Keybind.fromParsedKey = fromParsedKey;
    function match(a, b) {
        return (a.name === b.name &&
            !!a.ctrl === !!b.ctrl &&
            !!a.meta === !!b.meta &&
            !!a.alt === !!b.alt &&
            !!a.shift === !!b.shift &&
            !!a.super === !!b.super &&
            !!a.leader === !!b.leader);
    }
    Keybind.match = match;
    function toString(info) {
        const parts = [];
        if (info.leader)
            parts.push("<leader>");
        if (info.ctrl)
            parts.push("ctrl");
        if (info.meta)
            parts.push("meta");
        if (info.shift)
            parts.push("shift");
        if (info.super)
            parts.push("super");
        parts.push(info.name);
        return parts.join("+");
    }
    Keybind.toString = toString;
})(Keybind || (Keybind = {}));
//# sourceMappingURL=keybind.js.map