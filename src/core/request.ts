import { Response } from 'k6/http';
import { sleep, Checkers } from 'k6';

import { RequestTemplate, Request, ExtractUrlVariables, UrlPathType, TQueryParamsBase, RetryOptions } from '../types.ts';
import { HttpSession } from './session.ts';
import { serializeObject } from './helpers.ts';

export class RequestBuilder<TUrl extends string, TQueryParams extends TQueryParamsBase = {}> {
    template: RequestTemplate<TUrl>;
    request: Request;

    constructor(template: RequestTemplate<TUrl>) {
        this.template = template;
        this.request = {
            method: template.method,
            url: template.url,
            body: null,
            params: {
                headers: { ...template.params?.headers },
                tags: { name: template.url, ...template.params?.tags },
            },
            checks: template.checks,
            abortOnFailedChecks: this.template.abortOnFailedChecks,
        };
    }

    static init<TUrl extends string, TQueryParams extends TQueryParamsBase = {}>(
        template: RequestTemplate<TUrl, TQueryParams>,
    ): RequestBuilder<TUrl, TQueryParams> {
        return new RequestBuilder(template);
    }

    url(queryVar: ExtractUrlVariables<TUrl> extends never ? void : UrlPathType<TUrl>) {
        if (queryVar) {
            for (const v in queryVar) {
                const value = queryVar[v];
                if (value !== undefined && value !== null) this.request.url = this.request.url.replace(`{${v}}`, encodeURIComponent(String(value)));
            }
        }
        return this;
    }

    urlParam(queryParam?: TQueryParams) {
        if (queryParam && Object.keys(queryParam).length > 0) {
            const queryString = serializeObject(queryParam).join('&');
            if (queryString) this.request.url += this.request.url.includes('?') ? '&' : '?' + queryString;
        }
        return this;
    }

    body(data?: any) {
        if (data && Object.keys(data).length > 0)
            this.request.body = JSON.stringify(data);
        return this;
    }

    addHeader(name: string, value: string) {
        if (this.request.params?.headers) this.request.params.headers[name] = value;
    }

    build(): Request {
        return this.request;
    }

    execute(session: HttpSession, retry?: RetryOptions) {
        return new RequestExecutor(this.build(), session).run(retry);
    }

    _serialize(obj: any): string[] {
        const parts: string[] = [];
        for (const key in obj) {
            const value = obj[key];
            if (value !== null && typeof value === 'object') {
                parts.push(...this._serialize(value));
            } else if (value !== undefined) {
                parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
            }
        }
        return parts;
    }
}

export class RequestExecutor {
    private _response?: Response;
    private _checks?: Checkers<Response>;
    private _passed: boolean = false;
    private _attempts: number = 0;
    private _retries: number = 0;
    private _interval: number = 0;

    constructor(
        private _request: Request,
        private _session: HttpSession,
    ) { }

    run({ retries, interval }: RetryOptions = { retries: 0, interval: 0 }) {
        this._retries = retries;
        this._interval = interval ?? 0;
        this._response = this._session.send(this._request);
        this._attempts = 1;
        return this;
    }

    check(data?: Checkers<Response>, failError: boolean = true, logError: boolean = true) {
        this._checks = { ...data, ...this._request.checks };

        if (!this._response) {
            throw new Error(`Cannot run check(): No response found. Did you call execute() before check()?`);
        }
        if (!this._checks || Object.keys(this._checks).length === 0) {
            throw new Error(
                `No checks provided for request: ${this._request.method} ${this._request.url}. Add checks in template, builder or check() method.`,
            );
        }

        let hasRetries = this._attempts <= this._retries;
        this._passed = this._session.check(
            this._response,
            this._checks,
            hasRetries ? false : failError,
            hasRetries ? logError : true,
            this._attempts,
        );

        while (!this._passed && this._attempts <= this._retries) {
            if (this._interval > 0) sleep(this._interval / 1000);

            this._response = this._session.send(this._request);
            this._attempts++;

            hasRetries = this._attempts <= this._retries;
            this._passed = this._session.check(
                this._response,
                this._checks,
                hasRetries ? false : failError,
                hasRetries ? logError : true,
                this._attempts,
            );
        }
        return this;
    }

    get response() {
        return this._response!;
    }
}
