import Link from 'next/link';
import { ArrowLeft, Cpu, Shield, Database, Link2, FileText, BookOpen, AlertTriangle, CheckCircle, GitBranch } from 'lucide-react';

interface BasisLayoutProps {
  children: React.ReactNode;
  title: string;
  description?: string;
  breadcrumb?: string;
}

export function BasisLayout({ children, title, description, breadcrumb }: BasisLayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
      <div className="flex pt-16">
        {/* Sidebar */}
        <aside className="hidden lg:block w-64 fixed h-[calc(100vh-4rem)] overflow-y-auto border-r border-white/5 p-6">
          <Link href="/basis" className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" /> Back to BASIS
          </Link>

          <div className="space-y-6">
            <NavSection title="Architecture">
              <NavLink href="/basis/spec" icon={<FileText className="w-4 h-4" />}>Core Specification</NavLink>
              <NavLink href="/basis/intent" icon={<Cpu className="w-4 h-4" />}>INTENT Layer</NavLink>
              <NavLink href="/basis/enforce" icon={<Shield className="w-4 h-4" />}>ENFORCE Layer</NavLink>
              <NavLink href="/basis/proof" icon={<Database className="w-4 h-4" />}>PROOF Layer</NavLink>
              <NavLink href="/basis/chain" icon={<Link2 className="w-4 h-4" />}>CHAIN Layer</NavLink>
            </NavSection>

            <NavSection title="Reference">
              <NavLink href="/basis/trust" icon={<CheckCircle className="w-4 h-4" />}>Trust Model</NavLink>
              <NavLink href="/basis/capabilities" icon={<BookOpen className="w-4 h-4" />}>Capabilities</NavLink>
              <NavLink href="/basis/schemas" icon={<FileText className="w-4 h-4" />}>JSON Schemas</NavLink>
              <NavLink href="/basis/errors" icon={<AlertTriangle className="w-4 h-4" />}>Error Codes</NavLink>
            </NavSection>

            <NavSection title="Operations">
              <NavLink href="/basis/threat-model" icon={<Shield className="w-4 h-4" />}>Threat Model</NavLink>
              <NavLink href="/basis/failure-modes" icon={<AlertTriangle className="w-4 h-4" />}>Failure Modes</NavLink>
              <NavLink href="/basis/compliance" icon={<CheckCircle className="w-4 h-4" />}>Compliance</NavLink>
              <NavLink href="/basis/migration" icon={<GitBranch className="w-4 h-4" />}>Migration Guide</NavLink>
            </NavSection>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64 p-6 lg:p-12 max-w-4xl">
          {breadcrumb && (
            <div className="flex items-center gap-2 text-sm text-neutral-500 mb-4">
              <Link href="/basis" className="hover:text-white transition-colors">BASIS</Link>
              <span>/</span>
              <span className="text-neutral-300">{breadcrumb}</span>
            </div>
          )}

          <h1 className="text-4xl font-bold text-white mb-4">{title}</h1>
          {description && (
            <p className="text-lg text-neutral-400 mb-8">{description}</p>
          )}

          <article className="prose prose-invert prose-neutral max-w-none">
            {children}
          </article>
        </main>
      </div>
    </div>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">{title}</h3>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
      >
        {icon}
        {children}
      </Link>
    </li>
  );
}
