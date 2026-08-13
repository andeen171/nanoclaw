/**
 * Claude provider container config — only registered when the user has
 * configured a custom Anthropic-compatible endpoint via setup. Setup
 * appends `import './claude.js'` to providers/index.ts at that point;
 * standard installs hitting api.anthropic.com don't need this file
 * loaded.
 *
 * The real auth token never enters the container. Setup creates an
 * OneCLI generic secret (host-pattern = base URL hostname, header-name
 * = Authorization, value-format = "Bearer {value}") so the proxy
 * rewrites the Authorization header on the wire. The container only
 * needs:
 *   - ANTHROPIC_BASE_URL — so the SDK knows where to call
 *   - ANTHROPIC_AUTH_TOKEN=placeholder — so the SDK adds an
 *     Authorization: Bearer header for OneCLI to overwrite
 */
import { execFileSync } from 'node:child_process';
import { readEnvFile } from '../env.js';
import { registerProviderContainerConfig } from './provider-container-registry.js';

/**
 * Resolve a sibling container's bridge IP by name.
 *
 * Needed when the endpoint is another container on the default bridge (e.g. a
 * local OmniRoute gateway). Two things rule out the obvious alternatives:
 *   - the default bridge has no embedded DNS, so the container name doesn't
 *     resolve from inside an agent container;
 *   - a published port on the bridge gateway IP (172.17.0.1) is NOT reachable
 *     from other containers — Docker's DNAT rule carries `! -i docker0`, so
 *     traffic arriving from the bridge is never translated.
 *
 * Container-to-container over the bridge IP works, so we look the IP up at
 * spawn time rather than pinning it — it changes whenever containers come up
 * in a different order.
 */
function resolveContainerIp(name: string): string | undefined {
  try {
    const ip = execFileSync(
      'docker',
      ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', name],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return ip || undefined;
  } catch {
    return undefined;
  }
}

registerProviderContainerConfig('claude', () => {
  const dotenv = readEnvFile(['ANTHROPIC_BASE_URL']);
  const env: Record<string, string> = {};
  if (!dotenv.ANTHROPIC_BASE_URL) return { env };

  const url = new URL(dotenv.ANTHROPIC_BASE_URL);
  // A bare hostname (no dots, not an IP) means "sibling container" — resolve it.
  if (!/[.:]/.test(url.hostname) && url.hostname !== 'localhost') {
    const ip = resolveContainerIp(url.hostname);
    if (ip) url.hostname = ip;
  }

  env.ANTHROPIC_BASE_URL = url.origin;
  env.ANTHROPIC_AUTH_TOKEN = 'placeholder';
  // OneCLI injects HTTP_PROXY/HTTPS_PROXY for credential rewriting. This
  // endpoint holds its own upstream credentials and needs no injection, and
  // routing it through the proxy resets the connection — bypass it.
  env.NO_PROXY = url.hostname;
  env.no_proxy = url.hostname;
  return { env };
});
