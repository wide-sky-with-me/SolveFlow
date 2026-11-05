import { expect, it } from 'vitest';
import { examTransport, examOrigins } from './transport.js';

it('keeps HTTPS secure and requires explicit opt-in for an HTTP IP trial', () => {
    expect(examTransport('https://exam.example.com')).toEqual({ secure: true, cookieName: 'solveflow_exam' });
    expect(examTransport('http://127.0.0.1:3190')).toEqual({ secure: false, cookieName: 'solveflow_exam' });
    expect(() => examTransport('http://192.0.2.17:18443')).toThrow('HTTPS_OR_LOOPBACK_REQUIRED');
    expect(examTransport('http://192.0.2.17:18443', true)).toEqual({ secure: false, cookieName: 'solveflow_exam_http_trial' });
});

it('allows only explicit HTTP domain aliases on port 80 or the trial port',()=>{
    const ip='http://192.0.2.17:18443',domain='http://exam.example.test:18443';
    expect(examOrigins(ip,true,[domain])).toEqual([ip,domain]);
    expect(examOrigins(ip,true,['http://exam.example.test'])).toEqual([ip,'http://exam.example.test']);
    expect(()=>examOrigins('https://exam.example.test',false,[domain])).toThrow();
    for(const alias of ['http://exam.example.test:18444','https://exam.example.test:18443','http://*.example.test:18443',domain+'/path'])expect(()=>examOrigins(ip,true,[alias])).toThrow();
});

it.each([
    'http://exam.example.com:18443', 'http://192.0.2.17', 'http://192.0.2.17:80',
    'http://192.0.2.17:443', 'https://192.0.2.17:18443', 'ftp://192.0.2.17:18443',
    'http://name:password@192.0.2.17:18443', 'http://192.0.2.17:18443/',
    'http://192.0.2.17:18443/path', 'http://192.0.2.17:18443?query=1',
])('rejects accidental HTTP trial origins: %s', origin => {
    expect(() => examTransport(origin, true)).toThrow();
});
