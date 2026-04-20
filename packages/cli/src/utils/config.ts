import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LocalRelayConfig {
  project_id: string;
  project_name: string;
  initialized_at: string;
}

export function getLocalConfig(): LocalRelayConfig | null {
  const configPath = path.join(process.cwd(), '.relay', 'config.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export function hasLocalConfig(): boolean {
  return fs.existsSync(path.join(process.cwd(), '.relay', 'config.json'));
}
