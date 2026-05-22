import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { countTokens } from './tokenCounter';
import {
    parseShortStat,
    truncateDiffToBudget,
    formatDiffSummary,
    DiffStat,
} from './gitHelpers';

const execAsync = promisify(exec);

export interface GitDiffResult {
    diff: string;
    truncatedDiff: string;
    stat: DiffStat;
    base: string;            // "uncommitted (working tree)", "staged (index)", "last commit (HEAD~1..HEAD)"
    cwd: string;
    tokens: number;          // tokens in truncatedDiff
    rawTokens: number;       // tokens in original diff
}

const TIMEOUT_MS = 15_000;

export class GitContext {
    /**
     * Resolve a sensible cwd in this priority order:
     *   1. workspace folder containing the active file
     *   2. the active file's directory (works for "Open File…" without a folder — git walks up to find .git)
     *   3. first open workspace folder
     */
    static resolveCwd(): string | null {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme === 'file') {
            const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            if (folder) return folder.uri.fsPath;
            return path.dirname(editor.document.uri.fsPath);
        }
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) return folders[0].uri.fsPath;
        return null;
    }

    static async isGitRepo(cwd: string): Promise<boolean> {
        try {
            await execAsync('git rev-parse --git-dir', { cwd, timeout: TIMEOUT_MS });
            return true;
        } catch {
            return false;
        }
    }

    static async getUnstagedDiff(cwd: string, budget: number): Promise<GitDiffResult | null> {
        return runDiff(cwd, ['diff'], 'uncommitted (working tree)', budget);
    }

    static async getStagedDiff(cwd: string, budget: number): Promise<GitDiffResult | null> {
        return runDiff(cwd, ['diff', '--cached'], 'staged (index)', budget);
    }

    static async getLastCommitDiff(cwd: string, budget: number): Promise<GitDiffResult | null> {
        return runDiff(cwd, ['diff', 'HEAD~1', 'HEAD'], 'last commit (HEAD~1..HEAD)', budget);
    }

    static summaryLine(result: GitDiffResult): string {
        return formatDiffSummary(result.base, result.stat);
    }
}

async function runDiff(
    cwd: string,
    diffArgs: string[],
    base: string,
    budget: number,
): Promise<GitDiffResult | null> {
    const args = diffArgs.join(' ');
    let diff = '';
    let shortStatOut = '';
    try {
        const diffRes = await execAsync(
            `git ${args}`,
            { cwd, timeout: TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 },
        );
        diff = diffRes.stdout;
        const statRes = await execAsync(
            `git ${args} --shortstat`,
            { cwd, timeout: TIMEOUT_MS },
        );
        shortStatOut = statRes.stdout;
    } catch (err: unknown) {
        // For `git diff HEAD~1 HEAD` on a fresh repo (no second commit) this throws
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`git ${args} failed: ${msg.split('\n')[0]}`);
    }
    const stat = parseShortStat(shortStatOut);
    if (stat.files === 0 && diff.trim().length === 0) {
        return null;
    }
    const truncated = budget > 0 ? truncateDiffToBudget(diff, budget) : diff;
    return {
        diff,
        truncatedDiff: truncated,
        stat,
        base,
        cwd,
        tokens: countTokens(truncated),
        rawTokens: countTokens(diff),
    };
}
