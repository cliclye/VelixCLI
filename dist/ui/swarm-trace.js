import { c } from './theme.js';
function terminalWidth() {
    return process.stdout.columns ?? 100;
}
function formatValue(value) {
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value))
        return `[${value.map(formatValue).join(', ')}]`;
    if (value && typeof value === 'object')
        return JSON.stringify(value);
    return 'null';
}
function formatCall(name, args) {
    const entries = Object.entries(args).filter(([, value]) => value !== undefined);
    const inline = `${name}(${entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join(', ')})`;
    const maxInline = Math.max(50, terminalWidth() - 8);
    if (inline.length <= maxInline) {
        return [inline];
    }
    const lines = [`${name}(`];
    for (const [index, [key, value]] of entries.entries()) {
        const suffix = index === entries.length - 1 ? '' : ',';
        lines.push(`  ${key}: ${formatValue(value)}${suffix}`);
    }
    lines.push(')');
    return lines;
}
export function printSwarmActivity(activity) {
    if (activity.type === 'thought') {
        console.log(`  ${c.boldBlue('⏺')} ${activity.text}`);
        return;
    }
    const lines = formatCall(capitalize(activity.tool), activity.args);
    if (lines.length === 1) {
        console.log(`  ${c.boldBlue('⏺')} ${lines[0]}`);
    }
    else {
        console.log(`  ${c.boldBlue('⏺')} ${lines[0]}`);
        for (const line of lines.slice(1)) {
            console.log(`    ${line}`);
        }
    }
    for (const line of activity.summary.split('\n')) {
        console.log(`  ${c.gray('⎿')} ${line}`);
    }
}
export function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0)
        return `${seconds}s`;
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}
function capitalize(input) {
    return input.slice(0, 1).toUpperCase() + input.slice(1);
}
//# sourceMappingURL=swarm-trace.js.map