import * as os from 'os';
import * as path from 'path';

export function installedLspDirectory(
    platform = process.platform,
    userProfile = process.env.USERPROFILE ?? os.homedir(),
    localAppData = process.env.LOCALAPPDATA,
): string {
    if (platform === 'win32') {
        const base = localAppData || path.join(userProfile, 'AppData', 'Local');
        return path.join(base, 'Junexis', 'lsp');
    }
    if (platform === 'darwin') {
        return path.join(userProfile, 'Library', 'Application Support', 'Junexis', 'lsp');
    }
    return path.join(userProfile, '.local', 'share', 'junexis', 'lsp');
}
