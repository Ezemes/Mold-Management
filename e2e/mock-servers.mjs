// In-process stand-ins for an OIDC identity provider, a SAML identity provider and a webhook receiver.
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { SignedXml } from 'xml-crypto';

const read = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

/** OIDC provider at http://localhost:<port>. `idp.user` is who "signs in" next. */
export async function startOidc(port, { clientId, clientSecret }) {
  const issuer = `http://localhost:${port}`;
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  const idp = { issuer, user: null, idTokenOverride: null, tokenRequests: 0 };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, issuer);
    const json = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/.well-known/openid-configuration') return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], id_token_signing_alg_values_supported: ['RS256'] });
    if (u.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (u.pathname === '/authorize') {
      const p = u.searchParams;
      if (p.get('client_id') !== clientId || p.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { nonce: p.get('nonce'), challenge: p.get('code_challenge'), redirect: p.get('redirect_uri'), user: idp.user });
      res.writeHead(302, { Location: `${p.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(p.get('state'))}` });
      return res.end();
    }
    if (u.pathname === '/token' && req.method === 'POST') {
      idp.tokenRequests++;
      const auth = Buffer.from((req.headers.authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
      if (auth !== `${clientId}:${clientSecret}`) return json(401, { error: 'invalid_client' });
      const p = new URLSearchParams(await read(req));
      const c = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (!c || c.redirect !== p.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
      const challenge = crypto.createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const claims = { nonce: c.nonce, email: c.user.email, email_verified: true, given_name: c.user.first, family_name: c.user.last, groups: c.user.groups, ...(idp.idTokenOverride ?? {}) };
      const id_token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(idp.idTokenOverride?.iss ?? issuer).setAudience(idp.idTokenOverride?.aud ?? clientId).setSubject(c.user.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return json(200, { access_token: 'x', token_type: 'Bearer', id_token });
    }
    json(404, {});
  });
  await new Promise((r) => server.listen(port, r));
  return { idp, close: () => server.close() };
}

/** SAML IdP: answers the AuthnRequest with an auto-posting form carrying a signed assertion. */
export async function startSaml(port, { acsUrl, spEntityId, idpEntityId }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-saml-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/key.pem -out ${dir}/cert.pem -days 2 -subj "/CN=mock-idp"`, { stdio: 'ignore' });
  const key = fs.readFileSync(`${dir}/key.pem`, 'utf8');
  const cert = fs.readFileSync(`${dir}/cert.pem`, 'utf8');
  const idp = { user: null, tamper: false, cert, entryPoint: `http://localhost:${port}/sso`, issuer: idpEntityId, spEntityId };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${port}`);
    if (u.pathname !== '/sso') { res.writeHead(404); return res.end(); }
    const request = zlib.inflateRawSync(Buffer.from(u.searchParams.get('SAMLRequest'), 'base64')).toString();
    const inResponseTo = /ID="([^"]+)"/.exec(request)[1];
    const now = new Date();
    const t = (ms) => new Date(now.getTime() + ms).toISOString();
    const id = (p) => `${p}${crypto.randomBytes(12).toString('hex')}`;
    const attr = (name, values) => `<saml:Attribute Name="${name}">${values.map((v) => `<saml:AttributeValue>${esc(v)}</saml:AttributeValue>`).join('')}</saml:Attribute>`;
    const assertion =
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id('_a')}" Version="2.0" IssueInstant="${t(0)}">` +
      `<saml:Issuer>${idp.issuer}</saml:Issuer>` +
      `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${esc(idp.user.email)}</saml:NameID>` +
      `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${t(300_000)}" Recipient="${acsUrl}"/></saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${t(-60_000)}" NotOnOrAfter="${t(300_000)}"><saml:AudienceRestriction><saml:Audience>${spEntityId()}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${t(0)}" SessionIndex="${id('_s')}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
      `<saml:AttributeStatement>${attr('email', [idp.user.email])}${attr('firstName', [idp.user.first])}${attr('lastName', [idp.user.last])}${attr('groups', idp.user.groups)}</saml:AttributeStatement>` +
      `</saml:Assertion>`;
    const sig = new SignedXml({ privateKey: key, canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#', signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256' });
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256', transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'] });
    sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: 'after' } });
    let signed = sig.getSignedXml();
    // Simulate an attacker editing the signed assertion: the signature must then fail.
    if (idp.tamper) signed = signed.replace(esc(idp.user.email), 'boss@saml.example');
    const response =
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id('_r')}" Version="2.0" IssueInstant="${t(0)}" Destination="${acsUrl}" InResponseTo="${inResponseTo}">` +
      `<saml:Issuer>${idp.issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${signed}</samlp:Response>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><form id="f" method="post" action="${acsUrl}"><input type="hidden" name="SAMLResponse" value="${Buffer.from(response).toString('base64')}"/><input type="hidden" name="RelayState" value="${esc(u.searchParams.get('RelayState'))}"/></form><script>document.getElementById('f').submit()</script></body></html>`);
  });
  await new Promise((r) => server.listen(port, r));
  return { idp, close: () => server.close() };
}

/** Webhook receiver: /hook answers 200 and records each delivery with its signature check; /fail answers 500. */
export async function startReceiver(port) {
  const rx = { secret: null, received: [], failCalls: 0 };
  const server = http.createServer(async (req, res) => {
    const body = await read(req);
    if (req.url === '/fail') { rx.failCalls++; res.writeHead(500); return res.end('nope'); }
    const h = req.headers['x-pm-signature'] ?? '';
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(h);
    const valid = !!m && !!rx.secret && crypto.createHmac('sha256', rx.secret).update(`${m[1]}.${body}`).digest('hex') === m[2];
    rx.received.push({ event: req.headers['x-pm-event'], id: req.headers['x-pm-event-id'], valid, body: JSON.parse(body) });
    res.writeHead(200); res.end('ok');
  });
  await new Promise((r) => server.listen(port, r));
  return { rx, close: () => server.close() };
}
