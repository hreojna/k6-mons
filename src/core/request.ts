import { Params, Response } from 'k6/http'
import { sleep, Checkers } from 'k6'

import {
  RequestTemplate,
  Request,
  ExtractUrlVariables,
  UrlPathType,
  TQueryParamsBase,
  RetryOptions,
} from '../types.ts'
import { HttpSession } from './session.ts'
import { mergeParams, serializeObject } from './helpers.ts'

export class RequestBuilder<
  TUrl extends string,
  TQueryParams extends TQueryParamsBase = {},
> {
  template: RequestTemplate<TUrl>
  request: Request

  constructor(template: RequestTemplate<TUrl>) {
    this.template = template
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
    }
  }

  static init<TUrl extends string, TQueryParams extends TQueryParamsBase = {}>(
    template: RequestTemplate<TUrl, TQueryParams>
  ): RequestBuilder<TUrl, TQueryParams> {
    return new RequestBuilder(template)
  }

  url(
    queryVar: ExtractUrlVariables<TUrl> extends never ? void : UrlPathType<TUrl>
  ) {
    if (queryVar) {
      for (const v in queryVar) {
        const value = queryVar[v]
        if (value !== undefined && value !== null)
          this.request.url = this.request.url.replace(
            `{${v}}`,
            encodeURIComponent(String(value))
          )
      }
    }
    return this
  }

  urlParam(queryParam?: TQueryParams) {
    if (queryParam && Object.keys(queryParam).length > 0) {
      const queryString = serializeObject(queryParam).join('&')
      if (queryString)
        this.request.url += this.request.url.includes('?')
          ? '&'
          : '?' + queryString
    }
    return this
  }

  body(data?: any) {
    if (data && Object.keys(data).length > 0)
      this.request.body = JSON.stringify(data)
    return this
  }

  params(params?: Params) {
    if (params && Object.keys(params).length > 0)
      this.request.params = mergeParams(this.request.params, params)
    return this
  }

  addHeader(name: string, value: string) {
    if (this.request.params?.headers) this.request.params.headers[name] = value
  }

  build(): Request {
    return this.request
  }

  execute(session: HttpSession, retry?: RetryOptions) {
    return new RequestExecutor(this.build(), session).run(retry)
  }

}

export class RequestExecutor {
  private _response?: Response
  private _checks?: Checkers<Response>
  private _passed: boolean | undefined
  private _attempts: number = 0
  private _retry: RetryOptions

  constructor(
    private _request: Request,
    private _session: HttpSession
  ) {
    this._checks = this._request.checks
    this._retry = { retries: 0, interval: 0, ..._session.option.retry }
  }

  run(retry?: RetryOptions) {
    this._retry = { ...this._retry, ...retry }
    this._response = this._session.send(this._request)
    this._attempts = 0
    return this
  }

  check(
    checks?: Checkers<Response>,
    failError: boolean = true,
    logError: boolean = true
  ) {
    this._checks = { ...checks, ...this._checks }

    if (!this._response) {
      throw new Error(
        `Cannot run check(): No response found. Did you call execute() before check()?`
      )
    }
    if (!this._checks || Object.keys(this._checks).length === 0) {
      throw new Error(
        `No checks provided for request: ${this._request.method} ${this._request.url}. Add checks in template, builder or check() method.`
      )
    }

    let hasRetries = this._attempts < this._retry.retries
    this.runCheck(this._attempts, hasRetries, failError, logError)

    while (!this._passed && this._attempts < this._retry.retries) {
      if (this._retry.interval! > 0) sleep(this._retry.interval! / 1000)

      this._response = this._session.send(this._request)
      this._attempts++

      hasRetries = this._attempts <= this._retry.retries
      this.runCheck(this._attempts, hasRetries, failError, logError)
    }
    return this
  }

  runCheck(
    attempts: number,
    hasRetries: boolean,
    failError: boolean = true,
    logError: boolean = true
  ) {
    this._passed = this._session.check(
      this._response!,
      this._checks!,
      hasRetries ? false : failError,
      hasRetries ? logError : true,
      attempts
    )
  }

  get response() {
    return this._response!
  }

  set response(res: Response) {
    this._response = res
  }

  get request() {
    return this._request
  }

  set request(req: Request) {
    this._request = req
  }

  public isPassed() {
    return this._passed
  }

}

export class BatchExecutor {
  private _requests: Request[]
  private _executors: RequestExecutor[]
  private _attempts: number = 0
  private _retries: number = 0
  private _interval: number = 0

  constructor(
    requests: Request[],
    private _session: HttpSession
  ) {
    this._requests = requests
    this._executors = requests.map(
      (req) => new RequestExecutor(req, this._session)
    )
  }

  run({ retries, interval }: RetryOptions = { retries: 0, interval: 0 }) {
    this._retries = retries
    this._interval = interval ?? 0
    const responses = this._session.sendBatch(this._requests)
    this._executors.forEach((exec, i) => (exec.response = responses[i]))
    return this
  }

  check(failError: boolean = true, logError: boolean = true) {
    this.runCheck(failError, logError)

    while (this._hasFailedRequests() && this._attempts < this._retries) {
      if (this._interval > 0) sleep(this._interval / 1000)
      this._attempts++

      const failedExecutors = this._executors.filter((e) => !e.isPassed())
      const responses = this._session.sendBatch(
        failedExecutors.map((e) => e.request)
      )
      failedExecutors.forEach((exec, i) => (exec.response = responses[i]))

      this.runCheck(failError, logError)
    }

    return this
  }

  runCheck(failError: boolean, logError: boolean) {
    const hasRetries = this._attempts < this._retries
    this._executors.forEach((exec) => {
      if (!exec.isPassed()) exec.runCheck(this._attempts, hasRetries, failError, logError)
    })
  }

  private _hasFailedRequests(): boolean {
    return this._executors.some((e) => !e.isPassed())
  }

  get responses(): Response[] {
    return this._executors.map((e) => e.response)
  }
}
