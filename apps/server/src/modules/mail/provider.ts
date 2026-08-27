export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
  grantedScopes: string[];
}

export interface MailIdentity {
  externalAccountId: string;
  emailAddress: string;
}

export interface SendAsAddress {
  emailAddress: string;
  primary: boolean;
  verified: boolean;
}

export interface SentMessage {
  providerMessageId: string;
  providerThreadId: string;
}

export class MailProviderError extends Error {
  constructor(
    readonly category: string,
    message: string,
    readonly deliveryAmbiguous: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MailProviderError";
  }
}

export interface MailHistoryPage {
  historyId: string;
  messageIds: string[];
  nextPageToken: string | null;
}

export interface ProviderMessageMetadata {
  id: string;
  threadId: string;
  labelIds: string[];
  headers: Array<{ name: string; value: string }>;
}

export interface ProviderMessageReference {
  providerMessageId: string;
  providerThreadId: string;
}

export interface ProviderMessagePage {
  messages: ProviderMessageReference[];
  nextPageToken: string | null;
}

export interface MailProvider {
  readonly id: "gmail";
  exchangeAuthorizationCode(
    code: string,
    verifier: string,
    redirectUri: string,
  ): Promise<OAuthTokens>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;
  getIdentity(accessToken: string): Promise<MailIdentity>;
  listSendAs(accessToken: string): Promise<SendAsAddress[]>;
  send(
    accessToken: string,
    rawMessage: Uint8Array,
    threadId?: string,
  ): Promise<SentMessage>;
  findByRfcMessageId(
    accessToken: string,
    rfcMessageId: string,
  ): Promise<SentMessage | null>;
  getHistory(
    accessToken: string,
    startHistoryId: string,
    pageToken?: string,
  ): Promise<MailHistoryPage>;
  searchSentMessages(
    accessToken: string,
    query: string,
    maxResults: number,
  ): Promise<ProviderMessageReference[]>;
  listMessages(
    accessToken: string,
    input: {
      labelId: "INBOX" | "SENT";
      query?: string;
      pageToken?: string;
      maxResults: number;
    },
  ): Promise<ProviderMessagePage>;
  getMessageMetadata(
    accessToken: string,
    messageId: string,
  ): Promise<ProviderMessageMetadata>;
  getMessageRaw(accessToken: string, messageId: string): Promise<Uint8Array>;
  getProfileHistoryId(accessToken: string): Promise<string>;
  getThreadMessageIds(accessToken: string, threadId: string): Promise<string[]>;
  startWatch(
    accessToken: string,
    topicName: string,
  ): Promise<{ historyId: string; expiresAt: string }>;
  stopWatch(accessToken: string): Promise<void>;
  revoke(refreshToken: string): Promise<void>;
}
