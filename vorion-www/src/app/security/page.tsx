import type { Metadata } from 'next';
import { Shield, Lock, Eye, FileCheck, AlertTriangle, Mail } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Security | VORION',
  description: 'VORION Security practices - How we protect your data and our commitment to security.',
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-black text-white py-32 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-600/10 border border-emerald-600/20 rounded-2xl mb-6">
            <Shield className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Security at VORION</h1>
          <p className="text-xl text-zinc-400 max-w-2xl mx-auto">
            Security is foundational to everything we build. As a governance infrastructure
            provider, we hold ourselves to the highest standards.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <Lock className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Encryption</h3>
            <p className="text-zinc-400">
              All data is encrypted in transit using TLS 1.3 and at rest using
              AES-256. API keys and secrets are stored using industry-standard
              key management systems.
            </p>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <Eye className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Audit Logging</h3>
            <p className="text-zinc-400">
              Comprehensive audit logs track all access and modifications.
              Logs are immutable and retained according to compliance requirements.
              SHA-256 proof chains ensure tamper-evidence.
            </p>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <FileCheck className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Compliance</h3>
            <p className="text-zinc-400">
              Our infrastructure is designed for alignment with SOC 2 Type II,
              GDPR, CCPA, and industry AI governance standards including
              NIST AI RMF and the EU AI Act.
            </p>
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <AlertTriangle className="w-8 h-8 text-amber-400 mb-4" />
            <h3 className="text-xl font-semibold mb-2">Incident Response</h3>
            <p className="text-zinc-400">
              We maintain a documented incident response plan with defined
              escalation procedures. Security incidents are communicated
              transparently to affected customers.
            </p>
          </div>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 mb-16">
          <h2 className="text-2xl font-semibold mb-6">Responsible Disclosure</h2>
          <p className="text-zinc-300 leading-relaxed mb-4">
            We value the security research community and welcome responsible
            disclosure of any security vulnerabilities. If you believe you have
            found a security issue in our services, please report it to us.
          </p>
          <div className="flex items-center gap-3 mt-6">
            <Mail className="w-5 h-5 text-emerald-400" />
            <a
              href="mailto:security@vorion.org"
              className="text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
            >
              security@vorion.org
            </a>
          </div>
          <p className="text-zinc-500 text-sm mt-4">
            We aim to respond to all security reports within 48 hours and will
            work with you to understand and address the issue.
          </p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8">
          <h2 className="text-2xl font-semibold mb-6">Infrastructure Security</h2>
          <ul className="space-y-4 text-zinc-300">
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Multi-region deployment with automatic failover</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Network segmentation and zero-trust architecture</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Regular penetration testing by third-party security firms</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Automated vulnerability scanning and dependency updates</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Role-based access control with principle of least privilege</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-emerald-400 mt-1">•</span>
              <span>Hardware security modules (HSM) for cryptographic operations</span>
            </li>
          </ul>
        </div>

        <div className="mt-12 text-center">
          <p className="text-zinc-500">
            For security-related inquiries, contact{' '}
            <a
              href="mailto:security@vorion.org"
              className="text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              security@vorion.org
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
