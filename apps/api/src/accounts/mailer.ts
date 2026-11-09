import nodemailer, { type Transporter } from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** True when messages really leave the server (SMTP configured). */
  readonly delivers: boolean;
  send(mail: Mail): Promise<void>;
}

/** Used when SMTP is not configured: the message goes to the log so an operator can use the link. */
export class LogMailer implements Mailer {
  readonly delivers = false;
  constructor(private readonly log: (line: string) => void = console.warn) {}
  async send(mail: Mail): Promise<void> {
    this.log(
      `[mail not sent: SMTP_URL is not set] to=${mail.to} subject="${mail.subject}"\n${mail.text}`,
    );
  }
}

export class SmtpMailer implements Mailer {
  readonly delivers = true;
  private readonly transport: Transporter;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}

/** Captures messages; tests read them to follow links. */
export class MemoryMailer implements Mailer {
  readonly delivers = true;
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
  last(): Mail | undefined {
    return this.sent[this.sent.length - 1];
  }
}
