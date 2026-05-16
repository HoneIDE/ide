/**
 * PR Review panel — lists pull requests and shows AI review annotations.
 *
 * SHIP-V1-GAPS.md #13 honest framing (2026-05-13): the real GitHub API wiring
 * (OAuth device flow → REST list / show / comment) lives in `hone-core` as
 * request descriptors but the IDE doesn't execute the HTTP. v1 surfaces the
 * panel as a coming-in-v1.1 affordance instead of pretending to load PRs.
 * Once `hone-core/src/git/platform/{github,gitlab,bitbucket}.ts` is wired
 * through fetch (or a Perry HTTP FFI), the gated message goes away and the
 * existing token field becomes useful.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  textSetFontSize, textSetFontWeight,
  buttonSetBordered,
  widgetAddChild,
} from 'perry/ui';
import { t } from 'perry/i18n';
import { setFg, setBtnFg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

export function renderPRReviewPanel(container: unknown, colors: ResolvedUIColors): void {
  const title = Text(t('PULL REQUESTS'));
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  const subtitle = Text(t('Coming in v1.1'));
  textSetFontSize(subtitle, 11);
  setFg(subtitle, colors.sideBarForeground);
  widgetAddChild(container, subtitle);

  // Honest framing: name the limitation. The AI-review engine and
  // platform-request descriptors live in hone-core; the IDE just doesn't
  // execute HTTP yet. Keep the panel reachable so the muscle memory is in
  // place once v1.1 lands.
  const body = Text(t('AI-assisted pull request review will land in v1.1. The review engine and per-platform request descriptors (GitHub / GitLab / Bitbucket) are written in hone-core, but the HTTP execution path and OAuth device flow haven\'t shipped yet. Until then, please review PRs in your browser or via the gh CLI.'));
  textSetFontSize(body, 12);
  setFg(body, colors.sideBarForeground);
  widgetAddChild(container, body);

  // Surface the CLI as the bridge.
  const cliHint = Text(t('Tip: open the integrated terminal (Ctrl+`) and run `gh pr list` for a quick overview.'));
  textSetFontSize(cliHint, 11);
  setFg(cliHint, colors.sideBarForeground);
  widgetAddChild(container, cliHint);

  widgetAddChild(container, Spacer());
}
