export type ParsedKey = {
    name: string;
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
    shift?: boolean;
    super?: boolean;
};
export declare namespace Keybind {
    interface Info {
        name: string;
        ctrl?: boolean;
        meta?: boolean;
        alt?: boolean;
        shift?: boolean;
        super?: boolean;
        leader?: boolean;
    }
    function parse(value: string): Info[];
    function fromParsedKey(evt: ParsedKey, leader: boolean): Info;
    function match(a: Info, b: Info): boolean;
    function toString(info: Info): string;
}
//# sourceMappingURL=keybind.d.ts.map