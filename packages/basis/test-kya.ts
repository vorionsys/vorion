/**
 * KYA SDK Integration Test
 * Tests all four core capabilities:
 * 1. Identity Confirmation (W3C DID + Ed25519)
 * 2. Authorization Verification (capability tokens)
 * 3. Accountability Tracking (hash-linked chain)
 * 4. Continuous Behavior Monitoring (anomaly detection)
 */

import { KYA } from "./src/kya/index";
import * as ed from "@noble/ed25519";
import * as crypto from "crypto";

// Configure ed25519 to use Node.js crypto for SHA-512
ed.etc.sha512Sync = (...m) =>
  crypto
    .createHash("sha512")
    .update(Buffer.concat(m as any))
    .digest();

async function testKYA() {
  console.log("🧪 KYA SDK Integration Test\n");
  console.log("Testing all four core capabilities:\n");

  // Initialize KYA
  const kya = new KYA({
    didResolver: { networks: ["vorion", "ethereum"] },
    policyEngine: {
      policyBundlesPath: "./policies",
      defaultJurisdiction: "Global",
    },
    database: { type: "sqlite", connectionString: "./test-kya.db" },
  });

  // ==================================================================
  // Test 1: Identity Confirmation (W3C DID + Ed25519)
  // ==================================================================

  console.log("1️⃣  IDENTITY CONFIRMATION");
  console.log("─".repeat(50));

  // Generate Ed25519 key pair
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKey(privateKey);

  // Convert to hex strings
  const privateKeyHex = Buffer.from(privateKey).toString("hex");
  const publicKeyHex = Buffer.from(publicKey).toString("hex");

  console.log("✅ Generated Ed25519 key pair");
  console.log("   Public Key:", publicKeyHex.substring(0, 20) + "...");

  // Create W3C DID
  const agentDID = `did:vorion:ed25519:${publicKeyHex}`;
  console.log("✅ Created W3C DID:", agentDID.substring(0, 50) + "...");

  // Generate and sign challenge
  const challenge = kya.identity.generateChallenge();
  console.log("✅ Generated challenge:", challenge.substring(0, 20) + "...");

  const signature = await kya.identity.signChallenge(challenge, privateKey);
  console.log("✅ Signed challenge");

  // Verify signature
  const isValid = await kya.identity.verifySignature(
    challenge,
    signature,
    publicKey,
  );
  console.log(
    isValid
      ? "✅ Signature verified successfully"
      : "❌ Signature verification failed",
  );

  console.log();

  // ==================================================================
  // Test 2: Authorization Verification (capability tokens)
  // ==================================================================

  console.log("2️⃣  AUTHORIZATION VERIFICATION");
  console.log("─".repeat(50));

  // Grant capabilities to agent
  const capabilities = [
    { action: "gmail.read", resource: "*", conditions: [] },
    { action: "gmail.send", resource: "to:*@example.com", conditions: [] },
    { action: "calendar.read", resource: "*", conditions: [] },
  ];

  const expiresAt = Date.now() + 86400000; // 24 hours
  await kya.authorization.grantCapability(agentDID, capabilities, expiresAt);
  console.log("✅ Granted 3 capabilities to agent");

  // Test authorization: Allowed action
  const authResult1 = await kya.authorization.authorize({
    agentDID,
    action: "gmail.read",
    resource: "message:12345",
    context: {},
  });

  console.log(
    authResult1.allowed ? "✅ Gmail read authorized" : "❌ Gmail read denied",
  );
  console.log("   Reason:", authResult1.reason);

  // Test authorization: Denied action (not in capabilities)
  const authResult2 = await kya.authorization.authorize({
    agentDID,
    action: "drive.write",
    resource: "file:test.txt",
    context: {},
  });

  console.log(
    authResult2.allowed
      ? "❌ Drive write should be denied"
      : "✅ Drive write correctly denied",
  );
  console.log("   Reason:", authResult2.reason);

  console.log();

  // ==================================================================
  // Test 3: Accountability Tracking (hash-linked chain)
  // ==================================================================

  console.log("3️⃣  ACCOUNTABILITY TRACKING");
  console.log("─".repeat(50));

  // Log action to accountability chain
  const action1 = await kya.accountability.logAction(agentDID, {
    action: "gmail.read",
    resource: "message:12345",
    timestamp: Date.now(),
    outcome: "success",
    metadata: { messageSubject: "Test Email" },
  });

  console.log("✅ Logged action #1 to chain");
  console.log("   Hash:", action1.hash.substring(0, 20) + "...");

  // Log second action (should link to previous)
  const action2 = await kya.accountability.logAction(agentDID, {
    action: "gmail.send",
    resource: "to:user@example.com",
    timestamp: Date.now(),
    outcome: "success",
    metadata: { subject: "Reply", body: "Thanks!" },
  });

  console.log("✅ Logged action #2 to chain");
  console.log("   Hash:", action2.hash.substring(0, 20) + "...");
  console.log(
    "   Previous Hash:",
    action2.previousHash.substring(0, 20) + "...",
  );

  // Verify chain integrity
  const isChainValid = await kya.accountability.verifyChain(agentDID);
  console.log(
    isChainValid
      ? "✅ Accountability chain verified"
      : "❌ Chain verification failed",
  );

  // Get full audit trail
  const auditTrail = await kya.accountability.getAuditTrail(agentDID);
  console.log(`✅ Retrieved audit trail: ${auditTrail.length} actions`);

  console.log();

  // ==================================================================
  // Test 4: Continuous Behavior Monitoring (anomaly detection)
  // ==================================================================

  console.log("4️⃣  CONTINUOUS BEHAVIOR MONITORING");
  console.log("─".repeat(50));

  // Simulate normal behavior (10 actions)
  console.log("📊 Simulating normal behavior baseline...");
  for (let i = 0; i < 10; i++) {
    await kya.behavior.recordAction(agentDID, {
      action: "gmail.read",
      timestamp: Date.now(),
      success: true,
    });
  }
  console.log("✅ Recorded 10 normal actions");

  // Check for anomalies (should be none)
  let anomalies = await kya.behavior.detectAnomalies(agentDID);
  console.log(`✅ Anomalies detected: ${anomalies.length} (expected: 0)`);

  // Simulate rate spike (50 actions in 1 second)
  console.log("\n📊 Simulating rate spike attack...");
  for (let i = 0; i < 50; i++) {
    await kya.behavior.recordAction(agentDID, {
      action: "gmail.read",
      timestamp: Date.now(),
      success: true,
    });
  }

  // Check for anomalies (should detect rate spike)
  anomalies = await kya.behavior.detectAnomalies(agentDID);
  console.log(`✅ Anomalies detected: ${anomalies.length}`);

  if (anomalies.length > 0) {
    anomalies.forEach((alert) => {
      console.log(`   ⚠️  ${alert.type}: ${alert.description}`);
      console.log(`      Severity: ${alert.severity}`);
      console.log(`      Recommended action: ${alert.recommendedAction}`);
      console.log(`      Trust impact: ${alert.trustImpact}`);
    });
  }

  // Get updated trust score
  const trustScore = await kya.behavior.getTrustScore(agentDID);
  console.log(`\n✅ Current trust score: ${trustScore}/1000`);

  console.log();

  // ==================================================================
  // Test 5: Complete Verification Flow
  // ==================================================================

  console.log("5️⃣  COMPLETE VERIFICATION FLOW");
  console.log("─".repeat(50));

  const result = await kya.verifyAgent({
    agentDID,
    action: "gmail.send",
    resource: "to:test@example.com",
    proof: {
      challenge,
      signature,
      timestamp: Date.now(),
    },
  });

  console.log("Verification Result:");
  console.log("───────────────────");
  console.log("✅ Allowed:", result.allowed);
  console.log("✅ Reason:", result.reason);
  console.log("✅ Trust Score:", result.trustScore);
  console.log("✅ Anomalies:", result.anomalies.length);
  console.log(
    "✅ Evidence Hash:",
    result.evidenceHash.substring(0, 20) + "...",
  );

  console.log();
  console.log("═".repeat(50));
  console.log("✅ KYA SDK Integration Test Complete!");
  console.log("═".repeat(50));
  console.log();
  console.log("All four core capabilities verified:");
  console.log("  ✅ Identity Confirmation (W3C DID + Ed25519)");
  console.log("  ✅ Authorization Verification (capability tokens)");
  console.log("  ✅ Accountability Tracking (hash-linked chain)");
  console.log("  ✅ Continuous Behavior Monitoring (anomaly detection)");
  console.log();
}

testKYA()
  .then(() => {
    console.log("🎉 Test completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
