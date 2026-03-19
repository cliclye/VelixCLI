export interface VelixSession {
    id: string;
    title?: string;
    time: {
        created: number;
        updated: number;
        compacting?: number;
    };
}
export declare const Session: {
    list(): Promise<VelixSession[]>;
    create(input: {
        prompt?: string;
    }): Promise<VelixSession>;
    isDefaultTitle(title?: string): boolean;
};
//# sourceMappingURL=index.d.ts.map