import { Params, Response } from 'k6/http';
import { Checkers } from 'k6';

import { RequestTemplate } from '../types.ts';

export const statusIs = (...status: number[]): Checkers<Response> => ({
    [`status is ${status.sort().join(' or ')}`]: (r: Response) => status.includes(r.status),
});

export const mergeParams = (params1: Params | null | undefined, params2: Params | null | undefined): Params => {
    // const new_params = {
    return {
        ...params1,
        ...params2,
        headers: { ...params1?.headers, ...params2?.headers },
        tags: { ...params1?.tags, ...params2?.tags }
    };
    // new_params.headers = { ...params1?.headers, ...params2?.headers };
    // new_params.tags = { ...params1?.tags, ...params2?.tags };
    // return new_params;
};

export function makeRequestTemplate<TUrl extends string>(template: RequestTemplate<TUrl>) {
    return template;
}


export function serializeObject(obj: any): string[] {
    const parts: string[] = [];
    for (const key in obj) {
        const value = obj[key];
        if (value !== null && typeof value === 'object') {
            parts.push(...serializeObject(value));
        } else if (value !== undefined) {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    }
    return parts;
}