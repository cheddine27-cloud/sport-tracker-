type PageHeaderProps = {
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-border/40">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
          <span className="inline-block w-1.5 h-6 bg-emerald-500 rounded-full" />
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground pe-3.5">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex items-center gap-2 flex-wrap">{children}</div> : null}
    </div>
  );
}
