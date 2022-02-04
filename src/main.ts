import * as R from './jsreal';
import * as K from './kernels/kernel';
import * as D from './extras/debug/debug';
import * as Defs from './defs';

declare global {
    interface Window { [key: string]: any }
}

window.R = R;
window.LF = R.LongFloat;
window.LFS = R.LFSpecial;
window.K = K;
window.D = D;
window.Defs = Defs;
