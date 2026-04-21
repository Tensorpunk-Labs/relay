import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SessionState {
  session_id: string;
  project_id: string;
  actor_id: string;
  actor_type: 'agent' | 'human';
  /** Docker-style adjective-noun identifier for this run. Optional for
   *  pre-callsign sessions restored from disk. */
  callsign?: string;
  started_at: string;
  packages_pulled: string[];
  packages_deposited: string[];
  parent_package_id: string | null;
}

export class SessionManager {
  private relayDir: string;
  private sessionPath: string;

  constructor(workingDir?: string) {
    this.relayDir = path.join(workingDir || process.cwd(), '.relay');
    this.sessionPath = path.join(this.relayDir, 'session.json');
  }

  hasActiveSession(): boolean {
    return fs.existsSync(this.sessionPath);
  }

  getSession(): SessionState | null {
    if (!this.hasActiveSession()) return null;
    return JSON.parse(fs.readFileSync(this.sessionPath, 'utf-8'));
  }

  startSession(state: SessionState): void {
    fs.mkdirSync(this.relayDir, { recursive: true });
    fs.writeFileSync(this.sessionPath, JSON.stringify(state, null, 2));
  }

  endSession(): SessionState | null {
    const session = this.getSession();
    if (session && fs.existsSync(this.sessionPath)) {
      fs.unlinkSync(this.sessionPath);
    }
    return session;
  }

  trackPulled(packageId: string): void {
    const session = this.getSession();
    if (!session) return;
    if (!session.packages_pulled.includes(packageId)) {
      session.packages_pulled.push(packageId);
      fs.writeFileSync(this.sessionPath, JSON.stringify(session, null, 2));
    }
  }

  trackDeposited(packageId: string): void {
    const session = this.getSession();
    if (!session) return;
    session.packages_deposited.push(packageId);
    session.parent_package_id = packageId;
    fs.writeFileSync(this.sessionPath, JSON.stringify(session, null, 2));
  }

  setParentPackage(packageId: string): void {
    const session = this.getSession();
    if (!session) return;
    session.parent_package_id = packageId;
    fs.writeFileSync(this.sessionPath, JSON.stringify(session, null, 2));
  }
}
