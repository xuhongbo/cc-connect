export interface PreviewEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface PreviewEmbedAuthor {
  name: string;
  iconUrl?: string;
}

export interface PreviewEmbed {
  title?: string;
  description?: string;
  color?: number;
  author?: PreviewEmbedAuthor;
  fields?: PreviewEmbedField[];
}

export interface PreviewEmbedIdentity {
  label: string;
  iconUrl?: string;
  color?: number;
  title?: string;
}

export interface PreviewEmbedState {
  description?: string;
  thinking: string;
  tools: string;
  status?: string;
}

export const DEFAULT_AGENT_LABEL = 'AI 代理';
export const DEFAULT_AGENT_COLOR = 0x5865f2;
export const ERROR_COLOR = 0xed4245;

export function buildPreviewEmbed(identity: PreviewEmbedIdentity, state: PreviewEmbedState): PreviewEmbed {
  const description = state.description?.trim() ? state.description : '（内容生成中…）';
  const fields: PreviewEmbedField[] = [
    {
      name: 'Thinking',
      value: ensureFieldValue(state.thinking),
    },
    {
      name: 'Tools',
      value: ensureFieldValue(state.tools),
    },
  ];
  if (state.status?.trim()) {
    fields.push({
      name: 'Status',
      value: state.status,
    });
  }
  const author: PreviewEmbedAuthor = {
    name: identity.label,
  };
  if (identity.iconUrl) {
    author.iconUrl = identity.iconUrl;
  }
  return {
    title: identity.title ?? `${identity.label} 反馈`,
    description,
    color: identity.color ?? DEFAULT_AGENT_COLOR,
    author,
    fields,
  };
}

export function buildRuntimeErrorEmbed(identity: PreviewEmbedIdentity, message: string): PreviewEmbed {
  const title = identity.title ? `${identity.title} 错误` : `${identity.label} 错误`;
  return {
    title,
    description: buildRuntimeErrorText(message),
    color: ERROR_COLOR,
    author: {
      name: identity.label,
      iconUrl: identity.iconUrl,
    },
  };
}

export function buildRuntimeErrorText(message: string): string {
  return `执行失败：${message}`;
}

function ensureFieldValue(value: string): string {
  return value?.trim() ? value : '—';
}
