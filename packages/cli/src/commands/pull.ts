import { Command } from 'commander';
import { RelayClient, SessionManager } from '@relay/core';

export function pullCommand(): Command {
  return new Command('pull')
    .description('Pull context packages from the Context Core')
    .argument('[package_id]', 'Specific package ID to pull')
    .option('--latest', 'Pull the most recent package')
    .option('--project <id>', 'Project ID to pull from')
    .option('--next', 'Pull the next recommended work item')
    .option('--query <terms>', 'Semantic search for most relevant package')
    .action(async (packageId, opts) => {
      const client = await RelayClient.fromConfig();
      const sm = new SessionManager();

      if (packageId) {
        const pkg = await client.pullPackage(packageId);
        if (pkg) {
          sm.trackPulled(pkg.package_id);
          console.log(JSON.stringify(pkg, null, 2));
        } else {
          console.error(`Package ${packageId} not found`);
        }
        return;
      }

      if (opts.latest) {
        const packages = await client.getLatestPackages(opts.project, 1);
        if (packages.length > 0) {
          sm.trackPulled(packages[0].package_id);
          sm.setParentPackage(packages[0].package_id);
          console.log(JSON.stringify(packages[0], null, 2));
        } else {
          console.log('No packages found');
        }
        return;
      }

      if (opts.query) {
        const results = await client.search(opts.query, opts.project);
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      // Default: show latest packages
      const packages = await client.getLatestPackages(opts.project);
      console.log(JSON.stringify(packages, null, 2));
    });
}
