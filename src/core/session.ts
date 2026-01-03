import { check, Checkers, fail } from 'k6';
import http, { Params, Response } from 'k6/http';

import { HttpOption, Request } from '../types.ts';
import { mergeParams } from './helpers.ts';
import { RequestExecutor } from './request.ts';

export class HttpSession {
    option: HttpOption;
    params: Params;

    constructor(option: HttpOption) {
        this.option = option;
        this.params = { ...option.params };
    }

    executor(request: Request) {
        return new RequestExecutor(request, this);
    }

    execute(request: Request) {
        return new RequestExecutor(request, this).run();
    }

    send(request: Request): Response {
        return http.request(request.method, this.option.baseUrl + request.url, request.body, mergeParams(this.params, request.params));
    }

    async asyncSend(request: Request): Promise<Response> {
        return http.asyncRequest(request.method, this.option.baseUrl + request.url, request.body, mergeParams(this.params, request.params));
    }

    batch(requests: Request[]): Response[] {
        return http.batch(
            requests.map((request: Request) => [
                request.method,
                this.option.baseUrl + request.url,
                request.body,
                mergeParams(this.params, request.params),
            ]),
        );
    }

    async asyncBatch(requests: Request[]): Promise<Response[]> {
        return Promise.all(requests.map((request: Request) => this.asyncSend(request)));
    }

    check(response: Response, checks: Checkers<Response>, failError: boolean = true, logError: boolean = true, attempts = 1) {
        if (checks && Object.keys(checks).length > 0) {
            const result = check(response, checks);
            if (logError && !result && this.option.errorHandler) this.option.errorHandler.logError(response, attempts);
            if (failError && !result)
                if (attempts === 1) fail(`Request failed: ${response.request.method} ${response.request.url}`);
                else fail(`Request failed after ${attempts - 1} retries: ${response.request.method} ${response.request.url}`);
            return result;
        }
        return true;
    }

    addHeader(name: string, value: string) {
        if (this.params?.headers) this.params.headers[name] = value;
        return this;
    }
}

export class ErrorHandler {
    private logErrorDetails: Function;

    constructor(logErrorDetails: Function) {
        this.logErrorDetails = logErrorDetails;
    }

    logError(response: Response, retries: number = 1, tags?: Record<string, string>) {
        const traceparentHeader = response.request.headers['Traceparent'];
        const errorData = {
            url: response.url,
            status: response.status,
            error_code: response.error_code,
            error_body: (response.headers['Content-Type'] || response.headers['content-type'] || '').startsWith('application/json')
                ? response.json()
                : response.body,
            traceparent: traceparentHeader && traceparentHeader.toString(),
            retries: retries,
            tags: tags,
        };
        this.logErrorDetails(errorData);
    }
}
