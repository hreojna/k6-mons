import { Checkers } from 'k6'
import { Response, RequestBody, Params } from 'k6/http'
import { ErrorHandler } from './core/session.ts'

export enum Method {
  GET = 'GET',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
  TRACE = 'TRACE',
  PUT = 'PUT',
  DELETE = 'DELETE',
  POST = 'POST',
  PATCH = 'PATCH',
  CONNECT = 'CONNECT',
}

type SimpleType = string | number | boolean
type QueryParamsValue =
  | SimpleType
  | QueryParamsValue[]
  | { [key: string]: QueryParamsValue }
export type TQueryParamsBase = Record<string, QueryParamsValue>

type HasUrlParams<T extends string> =
  UrlPathType<T> extends Record<string, never> ? false : true
export type ExtractUrlVariables<T extends string> =
  T extends `${string}{${infer Param}}${infer Rest}`
    ? Param | ExtractUrlVariables<Rest>
    : never
export type UrlPathType<T extends string> = {
  [K in ExtractUrlVariables<T>]: SimpleType
}

export interface HttpOptions {
  baseUrl: string
  params: Params
}

export interface RequestTemplate<
  TUrl extends string,
  TQueryParams extends TQueryParamsBase = {},
> {
  method: Method
  url: TUrl
  body?: RequestBody | null
  params?: Params
  checks?: Checkers<Response>
  abortOnFailedChecks?: boolean
}

export interface Request {
  method: Method
  url: string
  body?: RequestBody | null
  params?: Params
  checks?: Checkers<Response>
  abortOnFailedChecks?: boolean
}

export interface Result<DT = undefined> {
  data?: DT
  response: Response
}

export interface RetryOptions {
  retries: number
  interval?: number
}

export interface HttpOption {
  baseUrl: string
  params?: Params
  abortOnFailedChecks?: boolean
  errorHandler?: ErrorHandler
  retry?: RetryOptions
}

export interface ExecuteOptions {
  params?: Params,
  retry?: RetryOptions,
  checks?: Checkers<Response>
}