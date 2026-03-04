import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | VORION',
  description: 'VORION Privacy Policy - How we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black text-white py-32 px-4">
      <div className="max-w-3xl mx-auto prose prose-invert prose-zinc">
        <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-zinc-400 mb-8">Last updated: January 20, 2026</p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Information We Collect</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          When you use VORION services, we may collect information you provide
          directly, such as your name, email address, and company information
          when you submit our contact form or sign up for our services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">How We Use Your Information</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">We use the information we collect to:</p>
        <ul className="list-disc list-inside text-zinc-300 space-y-2 mb-4">
          <li>Respond to your inquiries and provide customer support</li>
          <li>Provide, maintain, and improve our services</li>
          <li>Send you product updates and marketing communications (with your consent)</li>
          <li>Detect, prevent, and address technical issues and security threats</li>
          <li>Comply with legal obligations and enforce our terms</li>
        </ul>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Data Security</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          We implement appropriate technical and organizational measures to
          protect your personal information against unauthorized access,
          alteration, disclosure, or destruction. This includes encryption
          in transit and at rest, access controls, and regular security audits.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Data Retention</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          We retain your personal information only for as long as necessary
          to fulfill the purposes for which it was collected, including to
          satisfy legal, accounting, or reporting requirements.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Your Rights</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          Depending on your location, you may have rights regarding your personal
          information, including the right to access, correct, delete, or port your
          data. To exercise these rights, please contact us at the address below.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Third-Party Services</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          We may use third-party services for analytics, hosting, and other
          purposes. These services have their own privacy policies and may
          collect information as described in their respective policies.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Changes to This Policy</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          We may update this Privacy Policy from time to time. We will notify
          you of any changes by posting the new Privacy Policy on this page
          and updating the &quot;Last updated&quot; date.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">Contact Us</h2>
        <p className="text-zinc-300 leading-relaxed mb-4">
          If you have questions about this Privacy Policy, please contact us at{' '}
          <a href="mailto:privacy@vorion.org" className="text-emerald-400 hover:text-emerald-300 transition-colors">
            privacy@vorion.org
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
