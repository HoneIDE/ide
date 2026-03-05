/**
 * AI Chat panel — chat interface for AI assistant.
 */
import {
  VStack, HStack, Text, Button, Spacer,
  TextField, ScrollView, scrollViewSetChild,
  textSetFontSize, textSetFontWeight, textSetFontFamily,
  textSetString,
  buttonSetBordered,
  widgetAddChild, widgetClearChildren, widgetSetWidth,
  textfieldSetString,
} from 'perry/ui';
import { setFg, setBtnFg, setBg } from '../../ui-helpers';
import type { ResolvedUIColors } from '../../theme/theme-loader';

let chatInput: unknown = null;
let chatMessagesContainer: unknown = null;
let chatInputText = '';
let panelColors: ResolvedUIColors = null as any;

// Message storage — parallel arrays
let msgRoles: string[] = [];
let msgContents: string[] = [];
let msgCount: number = 0;

function onChatInput(text: string): void {
  chatInputText = text;
}

function onSend(): void {
  if (chatInputText.length < 1) return;
  // Add user message
  msgRoles[msgCount] = 'user';
  msgContents[msgCount] = chatInputText;
  msgCount = msgCount + 1;
  chatInputText = '';
  if (chatInput) textfieldSetString(chatInput, '');
  updateMessages();

  // Placeholder assistant response (real API call to be wired later)
  msgRoles[msgCount] = 'assistant';
  msgContents[msgCount] = 'AI responses will appear here when an API key is configured in ~/.hone/settings.json';
  msgCount = msgCount + 1;
  updateMessages();
}

function updateMessages(): void {
  if (!chatMessagesContainer) return;
  widgetClearChildren(chatMessagesContainer);
  for (let i = 0; i < msgCount; i++) {
    const role = msgRoles[i];
    const content = msgContents[i];
    const isUser = role.charCodeAt(0) === 117; // 'u'

    const msgText = Text(content);
    textSetFontSize(msgText, 12);
    if (panelColors) setFg(msgText, panelColors.sideBarForeground);

    const roleLabel = Text(isUser ? 'You' : 'Assistant');
    textSetFontSize(roleLabel, 10);
    textSetFontWeight(roleLabel, 10, 0.6);
    if (panelColors) setFg(roleLabel, panelColors.sideBarForeground);

    const msgBlock = VStack(2, [roleLabel, msgText]);
    if (panelColors && isUser) {
      setBg(msgBlock, panelColors.editorBackground);
    }
    widgetAddChild(chatMessagesContainer, msgBlock);
  }
}

export function renderChatPanel(container: unknown, colors: ResolvedUIColors): void {
  panelColors = colors;

  const title = Text('AI CHAT');
  textSetFontSize(title, 11);
  textSetFontWeight(title, 11, 0.7);
  setFg(title, colors.sideBarForeground);
  widgetAddChild(container, title);

  // Messages area
  chatMessagesContainer = VStack(4, []);
  const scroll = ScrollView();
  scrollViewSetChild(scroll, chatMessagesContainer);
  setBg(scroll, colors.sideBarBackground);
  widgetAddChild(container, scroll);

  // Restore existing messages
  if (msgCount > 0) {
    updateMessages();
  } else {
    const hint = Text('Ask a question about your code');
    textSetFontSize(hint, 12);
    setFg(hint, colors.sideBarForeground);
    widgetAddChild(chatMessagesContainer, hint);
  }

  // Input area
  chatInput = TextField('Ask a question...', (text: string) => { onChatInput(text); });
  const sendBtn = Button('Send', () => { onSend(); });
  buttonSetBordered(sendBtn, 0);
  textSetFontSize(sendBtn, 12);
  setBtnFg(sendBtn, colors.sideBarForeground);

  const inputRow = HStack(4, [chatInput, sendBtn]);
  widgetAddChild(container, inputRow);

  widgetAddChild(container, Spacer());
}
