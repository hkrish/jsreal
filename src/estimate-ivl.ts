

export interface EstimateIvl<T> {
    neg (): T;
    recip (): T;
    mul (rhs: T): T;
    mul_fast (rhs: number): T;
    div (rhs: T): T;
    div_fast (rhs: number): T;
}
