

export interface IReal {
    neg (): IReal;
    add (rhs: IReal): IReal;
    sub (rhs: IReal): IReal;
    mul (rhs: IReal): IReal;
    div (rhs: IReal): IReal;
    scale (rhs: number): IReal;

    sin (): IReal;
    cos (): IReal;
}
