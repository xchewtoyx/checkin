export interface NotificationResult {
  id: string;
}

export interface Notifier {
  readonly deliversNotifications: boolean;
  sendCheckin(url: string): Promise<NotificationResult>;
  sendAlert(title: string, message: string): Promise<NotificationResult>;
}

export class PushoverNotifier implements Notifier {
  readonly deliversNotifications = true;

  constructor(
    private readonly token: string,
    private readonly user: string,
  ) {}

  async sendCheckin(url: string): Promise<NotificationResult> {
    return this.post({
      message: "Time for a mood check-in",
      title: "checkin",
      url,
      url_title: "Check in",
    });
  }

  async sendAlert(title: string, message: string): Promise<NotificationResult> {
    return this.post({ title, message });
  }

  private async post(fields: Record<string, string>): Promise<NotificationResult> {
    const body = new URLSearchParams({
      token: this.token,
      user: this.user,
      ...fields,
    });

    const response = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      throw new Error(`Pushover request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { status: number; request: string };
    if (payload.status !== 1) {
      throw new Error("Pushover rejected notification");
    }

    return { id: payload.request };
  }
}

export class NoopNotifier implements Notifier {
  readonly deliversNotifications = false;

  async sendCheckin(_url: string): Promise<NotificationResult> {
    return { id: "noop" };
  }

  async sendAlert(_title: string, _message: string): Promise<NotificationResult> {
    return { id: "noop" };
  }
}
