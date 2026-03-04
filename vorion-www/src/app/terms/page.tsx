import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | VORION',
  description: 'VORION Terms of Service - Terms and conditions for using our services.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-black text-white py-32 px-4">
      <div className="max-w-3xl mx-auto prose prose-invert prose-zinc">
        <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
        <p className="text-zinc-400 mb-8">Last updated: January 20, 2026</p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Acceptance of Terms</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          By accessing or using VORION services, you agree to be bound by these
          Terms of Service and all applicable laws and regulations. If you do not
          agree with any of these terms, you are prohibited from using or accessing
          our services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Description of Services</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          VORION provides AI governance infrastructure, including trust scoring,
          capability gating, and audit trail services for autonomous AI agents.
          Our services are designed to help organizations maintain control and
          accountability over AI systems operating within their environments.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Use of Services</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          You may use our services only for lawful purposes and in accordance
          with these Terms. You agree not to use our services:
        </p>
        <ul className="list-disc list-inside text-zinc-300 space-y-2 mb-4">
          <li>In any way that violates applicable laws or regulations</li>
          <li>To exploit, harm, or attempt to exploit or harm minors</li>
          <li>To transmit any malicious code or conduct attacks on our systems</li>
          <li>To impersonate or attempt to impersonate VORION or another person</li>
          <li>To interfere with or disrupt the integrity of our services</li>
        </ul>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Account Responsibilities</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          If you create an account with us, you are responsible for maintaining
          the confidentiality of your account credentials and for all activities
          that occur under your account. You agree to notify us immediately of
          any unauthorized use of your account.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Intellectual Property</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          The service and its original content, features, and functionality are
          and will remain the exclusive property of Vorion Risk, LLC and its
          licensors. The service is protected by copyright, trademark, and other
          intellectual property laws.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">BASIS Standard License</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          The BASIS standard specification is made available under open terms
          to encourage adoption and interoperability. See the BASIS documentation
          for specific licensing terms applicable to the standard itself.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Disclaimer of Warranties</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          Our services are provided &quot;as is&quot; and &quot;as available&quot; without any
          warranties of any kind, either express or implied. We do not warrant
          that our services will be uninterrupted, secure, or error-free.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Limitation of Liability</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          In no event shall Vorion Risk, LLC, its directors, employees, partners,
          agents, suppliers, or affiliates be liable for any indirect, incidental,
          special, consequential, or punitive damages arising out of or related
          to your use of the service, whether based on warranty, contract, tort,
          or any other legal theory.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Indemnification</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          You agree to defend, indemnify, and hold harmless Vorion Risk, LLC
          from and against any claims, liabilities, damages, judgments, awards,
          losses, costs, or fees arising out of or relating to your violation
          of these Terms or your use of our services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Governing Law</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          These Terms shall be governed by and construed in accordance with
          the laws of the State of Delaware, without regard to its conflict
          of law provisions.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Changes to Terms</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          We reserve the right to modify or replace these Terms at any time.
          If a revision is material, we will provide at least 30 days&apos; notice
          prior to any new terms taking effect.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Contact Us</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          If you have questions about these Terms, please contact us at{' '}
          <a href="mailto:legal@vorion.org" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            legal@vorion.org
          </a>.
        </p>

        <div className="mt-12 pt-8 border-t border-zinc-800">
          <p className="text-zinc-500 text-sm">
            Vorion Risk, LLC<br />
            Governing AI for a safer autonomous future.
          </p>
        </div>
      </div>
    </div>
  );
}
