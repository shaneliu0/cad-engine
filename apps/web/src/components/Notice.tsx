import type { JSX, ReactNode } from "react";

interface NoticeProps {
  title: string;
  children?: ReactNode;
  role?: "status" | "alert";
  level?: 1 | 3;
}

export function Notice({
  title,
  children,
  role,
  level = 1,
}: NoticeProps): JSX.Element {
  const Heading = level === 1 ? "h1" : "h3";
  return (
    <section className="notice" role={role}>
      <Heading className="notice-title">{title}</Heading>
      {children !== undefined && <div className="notice-body">{children}</div>}
    </section>
  );
}
