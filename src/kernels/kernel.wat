
(module
 ;; ----- Functions: -----
 (import "functions" "raise" (func $raise-js (param i32) (param i32) (param i32)))
 (import "functions" "on_change_offsets" (func $on-change-offsets))
 (import "functions" "sin" (func $sin (param f64) (result f64)))
 (import "functions" "cos" (func $cos (param f64) (result f64)))

 (memory (export "memory") 1)

 ;; ----- Globals: -----
 (global $CONVMAXSZ  (export "ConvMaxSize")       (mut i32)  (i32.const 0))

 ;; ----- Memory layout: Arguments -----
 (global $OFFARG     (export "offset_arg")        (mut i32)  (i32.const 0))
 ;; ----- Memory layout: Scratch space -----
 (global $OFFSCR     (export "offset_scratch")    (mut i32)  (i32.const 0))
 ;; ----- Memory layout: Convolution -----
 (global $OFFCVW     (export "offset_cwei")       (mut i32)  (i32.const 0))
 (global $OFFCVB     (export "offset_cbr")        (mut i32)  (i32.const 0))
 ;; ----- Memory layout: Kernel scratch space -----
 (global $OFFKSC     (export "offset_kernsc")     (mut i32)  (i32.const 0))
 ;; ----- Total pages currently allocated -----
 (global $NPAGES     (export "memory_pages")      (mut i32)  (i32.const 0))

 ;; Kernel scratch buffers (offset into kernel scratch space)
 (global $OFFKBA     (mut i32)  (i32.const 0))
 (global $OFFKBB     (mut i32)  (i32.const 0))

 (global $PREC2POW   (mut i32)  (i32.const 0))

 ;; ----- Current kernel precision -----
 (global $KERNPREC   (export "kernel_precision")  (mut i32)  (i32.const 0))
 ;; ----- Current initialised size of the convolution kernel -----
 (global $CONVSZ     (export "CVSz")              (mut i32)  (i32.const 0))
 ;; ----- TODO: Test the convolution threshold -----
 ;; Direct multiplication will be used for precision below this threshold and convolution
 ;; for larger precision
 (global $CONVTHRESH (export "convolution_threshold") (mut i32) (i32.const 60))

 ;; Internal constants
 (global $PI2   f64  (f64.const 0x1.921fb54442d18p+2))

 ;; ============================================================================
 ;; ----- Memory layout -----
 ;; ============================================================================

 ;; FIX: Handle $preserve-args option
 (func $init-memory-layout
     (param $prec2pow i32) (param $preserve-args i32) (param $silent i32)
     (local $tmp i32) (local $max-args i32) (local $min-prec i32)
     (local $offset i32) (local $pages i32)
     ;; ----- These are hard-coded for now -----
     (local.set $min-prec (i32.const 2048))
     (local.set $max-args (i32.const 8))
     (if (i32.lt_u (local.get $prec2pow) (local.get $min-prec))
         (then (local.set $prec2pow (local.get $min-prec)))
       (else
        (if (call $is_not_pow2 (local.get $prec2pow))
            (then
             (call $raise1 (i32.const 2) (i32.const 1) (local.get $prec2pow))))))
     (local.set $pages (i32.const 1)) ;; Leave first page
     (local.set $offset (i32.mul (i32.const 65536) (local.get $pages)))
     ;; aegs-size: max-args * prec2pow * 8 bytes
     (global.set $OFFARG (local.get $offset))
     (local.set $tmp (i32.mul (local.get $max-args)
                              (i32.mul (local.get $prec2pow)
                                       (i32.const 8))))
     (local.set $tmp (call $round-mempage (local.get $tmp)))
     (local.set $pages (i32.add (local.get $tmp) (local.get $pages)))
     (local.set $offset (i32.mul (i32.const 65536) (local.get $pages)))
     ;; scratch space is equal to space for arguments
     (global.set $OFFSCR (local.get $offset))
     (local.set $pages (i32.add (local.get $tmp) (local.get $pages)))
     (local.set $offset (i32.mul (i32.const 65536) (local.get $pages)))
     ;; Convolution/weights: (prec2pow * 2) * 8 bytes
     (global.set $CONVMAXSZ (local.get $prec2pow))
     (global.set $OFFCVW (local.get $offset))
     (local.set $tmp (i32.mul (local.get $prec2pow) (i32.const 16)))
     ;; Convolution/bit-reversed indices: (size / 2) * 4 bytes
     (global.set $OFFCVB (i32.add (local.get $offset) (local.get $tmp)))
     (local.set $tmp (i32.add (local.get $tmp)
                              (i32.mul (local.get $prec2pow) (i32.const 2))))
     (local.set $tmp (call $round-mempage (local.get $tmp)))
     (local.set $pages (i32.add (local.get $tmp) (local.get $pages)))
     (local.set $offset (i32.mul (i32.const 65536) (local.get $pages)))
     ;; Kernel scratch space: (prec2pow * 2) * 8 bytes
     (global.set $OFFKSC (local.get $offset))
     ;;  Temp buffer A
     (global.set $OFFKBA (global.get $OFFKSC))
     (local.set $tmp (i32.mul (local.get $prec2pow) (i32.const 8)))
     ;;  Temp buffer B
     (global.set $OFFKBB (i32.add (global.get $OFFKBA) (local.get $tmp)))
     (local.set $tmp (i32.add (local.get $tmp)
                              (i32.mul (local.get $prec2pow) (i32.const 16))))
     (local.set $tmp (call $round-mempage (local.get $tmp)))
     (local.set $pages (i32.add (local.get $tmp) (local.get $pages)))
     (global.set $NPAGES (local.get $pages))
     (local.set $tmp (memory.size))
     (if (i32.gt_u (local.get $pages) (local.get $tmp))
         (then
          (local.set $tmp (memory.grow (i32.sub (local.get $pages) (local.get $tmp))))
          (if (i32.lt_s (local.get $tmp) (i32.const 0))
              (then
               (call $raise1 (i32.const 4) (i32.const 1)
                     (i32.mul (i32.const 65536) (local.get $pages)))))))
     (if (i32.eqz (local.get $silent))
         (then
          (call $on-change-offsets))))


 ;; ============================================================================
 ;; ----- Kernels -----
 ;; ============================================================================

 (func $initialize (export "initialize")
   (param $precision i32) (result i32)
   (local $kernscratch i32) (local $prec2pow i32)
   (local.set $kernscratch (global.get $OFFKSC))
   (if (i32.lt_u (local.get $precision) (i32.const 3))
       ;; At least cover double precision
       (local.set $precision (i32.const 3)))
   ;; Convolution will take 16 bits for a double. size should be at least twice the
   ;; number of 16-bit words
   (local.set $prec2pow (call $conv-size (local.get $precision)))
   (if (i32.ne (global.get $PREC2POW) (local.get $prec2pow))
       (then
        (global.set $PREC2POW (local.get $prec2pow))
        (global.set $KERNPREC (local.get $precision))
        (call $init-memory-layout (local.get $prec2pow) (i32.const 0) (i32.const 1))
        (call $conv_init (local.get $prec2pow))
        drop
        (call $on-change-offsets)))
   (local.get $prec2pow))

 (func $conv-size
     (param $prec i32) (result i32)
     (local $p4 i32) (local $p2p i32)
     (local.set $p2p (i32.const 16))
     (local.set $p4 (i32.mul (local.get $prec) (i32.const 4)))
     (loop $cont
       (if (i32.lt_u (local.get $p2p) (local.get $p4))
           (then
            (local.set $p2p (i32.mul (local.get $p2p) (i32.const 2)))
            (br $cont))))
     (local.get $p2p))

 ;; mantissa_normalize: Subtraction can introduce zeroes in most significant positions of
 ;; the mantissa. This function corrects such mantissas and returns the value that has to
 ;; be subtracted from the exponent. If this value is equal to working precision, the
 ;; subtraction function must recognize the value as Zero.
 (func $mantissa_normalize (export "mantissa_normalize")
   (param $man* i32) (result i32)
   (local $kprec i32) (local $prec i32) (local $j i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $prec (i32.sub (local.get $kprec) (i32.const 1)))
   (if (i32.load (call $i32idx (local.get $man*) (local.get $prec)))
       (return (i32.const 0)))
   ;; find the first non-zero word
   (local.set $prec (i32.sub (local.get $prec) (i32.const 1)))
   (loop $cont
     (if (i32.and (i32.ge_s (local.get $prec) (i32.const 0))
                  (i32.eqz (i32.load (call $i32idx (local.get $man*)
                                           (local.get $prec)))))
         (then
          (local.set $prec (i32.sub (local.get $prec) (i32.const 1)))
          (br $cont))))
   ;; calculate needed offset
   (local.set $prec (i32.sub (local.get $kprec) (i32.add (local.get $prec) (i32.const 1))))
   ;; do we have something to save?
   (if (i32.ne (local.get $prec) (local.get $kprec))
       (then
        (memory.copy (call $i32idx (local.get $man*) (local.get $prec))
                     (local.get $man*)
                     (i32.mul (i32.sub (local.get $kprec) (local.get $prec)) (i32.const 4)))
        (memory.fill (local.get $man*)
                     (i32.const 0)
                     (i32.mul (local.get $prec) (i32.const 4)))))
   (local.get $prec))

 ;; mantissa_add: Perform the actual addition.
 ;; - Arguments:
 ;;   - man   : Mantissa :: Destination, pre-initialized by a call to the default
 ;;                         constructor
 ;;   - full  : Mantissa :: The greater value
 ;;   - part  : Mantissa :: The partial value...
 ;;   - start : number   :: ...shifted by this many words
 ;; - Returns:
 ;;   - boolean  :: `true' if we have carry or not.
 (func $mantissa_add (export "mantissa_add")
   (param $man* i32) (param $full* i32) (param $part* i32) (param $start i32) (result i32)
   (local $kprec i32) (local $carry i64) (local $v i64) (local $u i32) (local $kpms i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $carry (i64.const 0))
   ;; start with carry if highest bit in what's left out is 1
   (if (i32.and (i32.ne (local.get $start) (i32.const 0))
                (i32.le_u (local.get $start) (local.get $kprec)))
       (then
        (local.set
         $carry
         (i64.extend_i32_u
          (i32.ge_u
           (i32.load (call $i32idx (local.get $part*)
                           (i32.sub (local.get $start) (i32.const 1))))
           (i32.shl (i32.const 1) (i32.const 31)))))))
   (local.set $kpms (i32.sub (local.get $kprec) (local.get $start)))
   (local.set $u (i32.const 0))
   ;; Add words
   (loop $cont
     (if (i32.le_u (local.get $u) (local.get $kpms))
         (then
          (local.set
           $v
           (i64.add
            (i64.extend_i32_u (i32.load (call $i32idx (local.get $full*) (local.get $u))))
            (i64.add
             (i64.extend_i32_u (i32.load (call $i32idx (local.get $part*)
                                               (i32.add (local.get $u) (local.get $start)))))
             (local.get $carry))))
          (i32.store (call $i32idx (local.get $man*) (local.get $u))
                     (i32.wrap_i64 (local.get $v)))
          (local.set $carry (i64.shr_u (local.get $v) (i64.const 32)))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; Update for carry
   (loop $cont
     (if (i32.and (i64.ne (local.get $carry) (i64.const 0))
                  (i32.lt_u (local.get $u) (local.get $kprec)))
         (then
          (i32.store
           (call $i32idx (local.get $man*) (local.get $u))
           (local.tee $kpms
                      (i32.add
                       (i32.load (call $i32idx (local.get $full*) (local.get $u)))
                       (i32.wrap_i64 (local.get $carry)))))
          (local.set $carry (i64.extend_i32_u (i32.eqz (local.get $kpms))))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; Copy rest
   (loop $cont
     (if (i32.lt_u (local.get $u) (local.get $kprec))
         (then
          (i32.store (call $i32idx (local.get $man*) (local.get $u))
                     (i32.load (call $i32idx (local.get $full*) (local.get $u))))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   (i64.ne (local.get $carry) (i64.const 0)))

 ;; adjust_for_carry: Adjust for calculations that don't fit the preallocated space.
 ;; an extra pass might be needed if the leftover word introduces more carry.
 ;; - Arguments:
 ;;   - man : Mantissa :: the mantissa
 ;;   - msw : number   :: most significant word, the one that doesn't fit in
 ;; - Returns:
 ;;   - number :: number of shifts done
 (func $adjust_for_carry (export "adjust_for_carry")
   (param $man* i32) (param $msw i32) (result i32)
   (local $kprec i32) (local $carry i32) (local $u i32)
   (local $tmp1 i32) (local $tmp2 i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $carry (i32.ge_u (i32.load (local.get $man*))
                               (i32.shl (i32.const 1) (i32.const 31))))
   ;; shift
   (local.set $u (i32.const 1))
   (loop $cont
     (if (i32.and (i32.lt_u (local.get $u) (local.get $kprec))
                  (i32.ne (local.get $carry) (i32.const 0)))
         (then
          (local.set $tmp1 (call $i32idx (local.get $man*) (local.get $u)))
          (local.set $tmp2 (i32.add (i32.load (local.get $tmp1)) (i32.const 1)))
          (i32.store (i32.sub (local.get $tmp1) (i32.const 4)) (local.get $tmp2))
          (local.set $carry (i32.eqz (local.get $tmp2)))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   (loop $cont
     (if (i32.lt_u (local.get $u) (local.get $kprec))
         (then
          (local.set $tmp1 (call $i32idx (local.get $man*) (local.get $u)))
          (local.set $tmp2 (i32.load (local.get $tmp1)))
          (i32.store (i32.sub (local.get $tmp1) (i32.const 4)) (local.get $tmp2))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; put new value
   (local.set $u (i32.sub (local.get $u) (i32.const 1)))
   (local.set $tmp1 (i32.add (local.get $msw) (local.get $carry)))
   (i32.store (call $i32idx (local.get $man*) (local.get $u)) (local.get $tmp1))
   ;; iterate again, if necessary
   (if (result i32) (i32.eqz (local.get $tmp1))
     (then
      (i32.add (i32.const 1) (call $adjust_for_carry (local.get $man*) (i32.const 1))))
     (else (i32.const 1))))

 ;; mantissa_sub: Perform the actual subtraction.
 ;; - Arguments:
 ;;   - man   : Mantissa :: Destination, pre-initialized by a call to the default constructor
 ;;   - full  : Mantissa :: The greater value
 ;;   - part  : Mantissa :: The partial value...
 ;;   - start : number   :: ...shifted by this many words
 ;; - Returns:
 ;;   - boolean :: `true' if part was greater and the result must be negated
 (func $mantissa_sub (export "mantissa_sub")
   (param $man* i32) (param $full* i32) (param $part* i32) (param $start i32) (result i32)
   (local $kprec i32) (local $carry i64) (local $v i64) (local $u i32) (local $kpms i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $carry (i64.const 0))
   ;; start with carry if highest bit in what's left out is 1
   (if (i32.and (i32.ne (local.get $start) (i32.const 0))
                (i32.le_u (local.get $start) (local.get $kprec)))
       (then
        (local.set $carry
                   (i64.extend_i32_u
                    (i32.ge_u
                     (i32.load (call $i32idx (local.get $part*)
                                     (i32.sub (local.get $start) (i32.const 1))))
                     (i32.shl (i32.const 1) (i32.const 31)))))))
   ;; Subtract words
   (local.set $kpms (i32.sub (local.get $kprec) (local.get $start)))
   (local.set $u (i32.const 0))
   (loop $cont
     (if (i32.lt_u (local.get $u) (local.get $kpms))
         (then
          (i32.store
           (call $i32idx (local.get $man*) (local.get $u))
           (i32.wrap_i64
            (local.tee
             $v
             (i64.sub
              (i64.sub
               (i64.extend_i32_u (i32.load (call $i32idx (local.get $full*) (local.get $u))))
               (i64.extend_i32_u (i32.load (call $i32idx (local.get $part*)
                                                 (i32.add (local.get $u) (local.get $start))))))
              (local.get $carry)))))
          (local.set $carry (i64.extend_i32_u
                             (i64.ne (i64.shr_u (local.get $v) (i64.const 32))
                                     (i64.const 0))))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; Update for carry
   (loop $cont
     (if (i32.and (i64.ne (local.get $carry) (i64.const 0))
                  (i32.lt_u (local.get $u) (local.get $kprec)))
         (then
          (i32.store (call $i32idx (local.get $man*) (local.get $u))
                     (local.tee
                      $kpms
                      (i32.sub
                       (i32.load (call $i32idx (local.get $full*) (local.get $u)))
                       (i32.wrap_i64 (local.get $carry)))))
          (local.set $carry (i64.extend_i32_u (i32.eq (local.get $kpms) (i32.const -1))))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; Copy rest
   (loop $cont
     (if (i32.lt_u (local.get $u) (local.get $kprec))
         (then
          (i32.store (call $i32idx (local.get $man*) (local.get $u))
                     (i32.load (call $i32idx (local.get $full*) (local.get $u))))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   (i64.ne (local.get $carry) (i64.const 0)))

 ;; mantissa_neg: negate a mantissa. needed if $mantissa_sub returned true.
 (func $mantissa_neg (export "mantissa_neg")
   (param $man* i32)
   (local $prec i32) (local $u i32) (local $tmp i32)
   (local.set $prec (global.get $KERNPREC))
   (local.set $u (i32.const 0))
   (loop $cont
     (if (i32.and (i32.lt_u (local.get $u) (local.get $prec))
                  (i32.eqz (i32.load (call $i32idx (local.get $man*) (local.get $u)))))
         (then
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont))))
   ;; assert (u < prec)
   (local.set $tmp (call $i32idx (local.get $man*) (local.get $u)))
   (i32.store (local.get $tmp) (i32.sub (i32.const 0) (i32.load (local.get $tmp))))
   (local.set $u (i32.add (local.get $u) (i32.const 1)))
   (loop $cont
     (if (i32.lt_u (local.get $u) (local.get $prec))
         (then
          (local.set $tmp (call $i32idx (local.get $man*) (local.get $u)))
          (i32.store (local.get $tmp) (i32.xor (i32.load (local.get $tmp)) (i32.const -1)))
          (local.set $u (i32.add (local.get $u) (i32.const 1)))
          (br $cont)))))

 ;; mantissa_mul_direct: Perform actual multiplication
 ;;
 ;; NOTE: For multiplying longer mantissas we'd use convolution
 ;;
 ;; the most significant word of the result is not put in man. instead it is returned, so
 ;; no precision will be lost if it is zero.
 (func $mantissa_mul_direct
     (param $man* i32) (param $a* i32) (param $b* i32) (param $instart i32)
     (param $inlen i32) (result i32)
     (local $kprec i32) (local $carry i32) (local $u i64) (local $w i64)
     (local $i i32) (local $j i32) (local $k i32)
     (local.set $kprec (global.get $KERNPREC))
     (local.set $carry (i32.const 0))
     (local.set $u (i64.const 0))
     (local.set $w (i64.const 0))
     (local.set $i (i32.add (i32.sub (local.get $kprec)
                                     (i32.mul (local.get $inlen) (i32.const 2)))
                            (i32.const 1)))
     (local.set $k (i32.const 0))
     ;; start by only calculating carry
     (loop $cont-i
       (if (i32.and (i32.lt_s (local.get $i) (i32.const 0))
                    (i32.lt_s (local.get $k) (local.get $inlen)))
           (then
            (local.set $w (i64.shr_u (local.get $w) (i64.const 32)))
            (local.set $w (i64.add (local.get $w)
                                   (i64.shl (i64.extend_i32_u (local.get $carry))
                                            (i64.const 32))))
            (local.set $carry (i32.const 0))
            (local.set $j (i32.const 0))
            (loop $cont-j
              (if (i32.le_u (local.get $j) (local.get $k))
                  (then
                   (local.set
                    $u
                    (i64.mul
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $a*)
                                      (i32.add (local.get $j) (local.get $instart)))))
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $b*)
                                      (i32.add (i32.sub (local.get $k) (local.get $j))
                                               (local.get $instart)))))))
                   (local.set $w (i64.add (local.get $w) (local.get $u)))
                   (if (i64.lt_s (local.get $w) (local.get $u))
                       (then
                        (local.set $carry (i32.add (local.get $carry) (i32.const 1)))))
                   (local.set $j (i32.add (local.get $j) (i32.const 1)))
                   (br $cont-j))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $cont-i))))
     ;; alternatively
     (local.set $j (i32.const 0))
     (loop $cont
       (if (i32.lt_s (local.get $j) (local.get $i))
           (then
            (i32.store (call $i32idx (local.get $man*) (local.get $j)) (i32.const 0))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $cont))))
     ;; assert: (i >= 0)
     ;;
     ;; we didn't write till now. Besides carry, we should add 1 if the previous value had
     ;; 1 in MS bit
     (if (i64.ne (i64.and (local.get $w) (i64.const 0x80000000)) (i64.const 0))
         (local.set $w (i64.add (local.get $w) (i64.shl (i64.const 1) (i64.const 32)))))
     ;; start writing
     (loop $cont-k
       (if (i32.lt_u (local.get $k) (local.get $inlen))
           (then
            (local.set $w (i64.shr_u (local.get $w) (i64.const 32)))
            (local.set $w (i64.add (local.get $w)
                                   (i64.shl (i64.extend_i32_u (local.get $carry))
                                            (i64.const 32))))
            (local.set $carry (i32.const 0))
            (local.set $j (i32.const 0))
            (loop $cont-j
              (if (i32.le_u (local.get $j) (local.get $k))
                  (then
                   (local.set
                    $u
                    (i64.mul
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $a*)
                                      (i32.add (local.get $j) (local.get $instart)))))
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $b*)
                                      (i32.add (i32.sub (local.get $k) (local.get $j))
                                               (local.get $instart)))))))
                   (local.set $w (i64.add (local.get $w) (local.get $u)))
                   (if (i64.lt_s (local.get $w) (local.get $u))
                       (then
                        (local.set $carry (i32.add (local.get $carry) (i32.const 1)))))
                   (local.set $j (i32.add (local.get $j) (i32.const 1)))
                   (br $cont-j))))
            (i32.store (call $i32idx (local.get $man*) (local.get $i))
                       (i32.wrap_i64 (i64.and (local.get $w) (i64.const 0xFFFFFFFF))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $cont-k))))
     (loop $cont-i
       (if (i32.lt_u (local.get $i) (local.get $kprec))
           (then
            (local.set $w (i64.shr_u (local.get $w) (i64.const 32)))
            (local.set $w (i64.add (local.get $w)
                                   (i64.shl (i64.extend_i32_u (local.get $carry))
                                            (i64.const 32))))
            (local.set $carry (i32.const 0))
            (local.set $j (i32.add (i32.sub (local.get $k) (local.get $inlen))
                                   (i32.const 1)))
            (loop $cont-j
              (if (i32.lt_u (local.get $j) (local.get $inlen))
                  (then
                   (local.set
                    $u
                    (i64.mul
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $a*)
                                      (i32.add (local.get $j) (local.get $instart)))))
                     (i64.extend_i32_u
                      (i32.load (call $i32idx (local.get $b*)
                                      (i32.add (i32.sub (local.get $k) (local.get $j))
                                               (local.get $instart)))))))
                   (local.set $w (i64.add (local.get $w) (local.get $u)))
                   (if (i64.lt_s (local.get $w) (local.get $u))
                       (then
                        (local.set $carry (i32.add (local.get $carry) (i32.const 1)))))
                   (local.set $j (i32.add (local.get $j) (i32.const 1)))
                   (br $cont-j))))
            (i32.store (call $i32idx (local.get $man*) (local.get $i))
                       (i32.wrap_i64 (i64.and (local.get $w) (i64.const 0xFFFFFFFF))))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br $cont-i))))
     (local.set $w (i64.shr_u (local.get $w) (i64.const 32)))
     ;; assert (!carry)
     (i32.wrap_i64 (i64.and (local.get $w) (i64.const 0xFFFFFFFF))))

 ;; mantissa_mul: Perform actual multiplication using convolution
 ;;
 ;; the most significant word of the result is not put in man. instead it is returned, so
 ;; no precision will be lost if it is zero.
 (func $mantissa_mul (export "mantissa_mul")
   (param $man* i32) (param $a* i32) (param $b* i32) (param $instart i32)
   (param $inlen i32) (result i32)
   (local $bufa i32) (local $bufb i32) (local $prec i32) (local $prec2pow i32)
   (local $i i32) (local $tmp1 i32) (local $tmp2 i32) (local $carry f64)
   (local $2^-16 f64) (local $2^16 f64) (local $t f64)
   ;; Do it directly if it would be faster
   (if (i32.lt_u (local.get $inlen) (global.get $CONVTHRESH))
       (then
        (return
         (call $mantissa_mul_direct (local.get $man*) (local.get $a*) (local.get $b*)
               (local.get $instart) (local.get $inlen)))))
   (local.set $bufa (global.get $OFFKBA))
   (local.set $bufb (global.get $OFFKBB))
   (local.set $prec (local.get $inlen))
   (if (i32.eq (local.get $inlen) (global.get $KERNPREC))
       (then (local.set $prec2pow (global.get $CONVSZ)))
     (else (local.set $prec2pow (call $conv-size (local.get $prec)))))
   ;; Initialise buffers to input
   (local.set $i (i32.const 0))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $inlen))
         (then
          ;; - bufferA
          (local.set $tmp1 (i32.load
                            (call $i32idx (local.get $a*)
                                  (i32.add (local.get $i) (local.get $instart)))))
          (local.set $tmp2 (call $reidx (local.get $bufa) (local.get $i)))
          (f64.store (local.get $tmp2)
                     (f64.convert_i32_u (i32.and (local.get $tmp1) (i32.const 0xFFFF))))
          (f64.store (call $nextf64idx (local.get $tmp2))
                     (f64.convert_i32_u
                      (i32.and (i32.shr_u (local.get $tmp1) (i32.const 16))
                               (i32.const 0xFFFF))))
          ;; - bufferB
          (local.set $tmp1 (i32.load
                            (call $i32idx (local.get $b*)
                                  (i32.add (local.get $i) (local.get $instart)))))
          (local.set $tmp2 (call $reidx (local.get $bufb) (local.get $i)))
          (f64.store (local.get $tmp2)
                     (f64.convert_i32_u (i32.and (local.get $tmp1) (i32.const 0xFFFF))))
          (f64.store (call $nextf64idx (local.get $tmp2))
                     (f64.convert_i32_u
                      (i32.and (i32.shr_u (local.get $tmp1) (i32.const 16))
                               (i32.const 0xFFFF))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   (local.set $i (i32.mul (local.get $i) (i32.const 2)))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $prec2pow))
         (then
          ;; - bufferA
          (f64.store (call $f64idx (local.get $bufa) (local.get $i)) (f64.const 0))
          ;; - bufferB
          (f64.store (call $f64idx (local.get $bufb) (local.get $i)) (f64.const 0))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   ;; convolve
   (call $convolve (local.get $bufa) (local.get $bufb) (local.get $prec2pow))
   ;; make each value 16-bit
   (local.set $2^-16 (f64.const 0x1p-16))
   (local.set $2^16 (f64.const 0x1p+16))
   (local.set $i (i32.const 0))
   (local.set $tmp2 (i32.sub (i32.sub (local.get $inlen) (i32.const 1))
                             (local.get $instart)))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $tmp2))
         (then
          (local.set $tmp1 (call $f64idx (local.get $bufa) (local.get $i)))
          (local.set $t (f64.floor
                         (f64.add (f64.load (local.get $tmp1))
                                  (f64.add (local.get $carry) (f64.const 0.5)))))
          (local.set $carry (f64.floor (f64.mul (local.get $t) (local.get $2^-16))))
          (f64.store
           (local.get $tmp1)
           (f64.sub (local.get $t) (f64.mul (local.get $carry) (local.get $2^16))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   ;; from here on we start writing, one in MSB of previous word is carry
   (if (f64.gt (f64.load (call $f64idx (local.get $bufa)
                               (i32.sub (local.get $i) (i32.const 1))))
               (f64.convert_i32_u (i32.shl (i32.const 1) (i32.const 15))))
       (then (local.set $carry (f64.add (local.get $carry) (f64.const 1)))))
   (local.set $tmp2 (i32.mul (i32.add (local.get $prec) (local.get $inlen))
                             (i32.const 2)))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $tmp2))
         (then
          (local.set $tmp1 (call $f64idx (local.get $bufa) (local.get $i)))
          (local.set $t
                     (f64.floor
                      (f64.add (f64.load (local.get $tmp1))
                               (f64.add (local.get $carry) (f64.const 0.5)))))
          (local.set $carry (f64.floor (f64.mul (local.get $t) (local.get $2^-16))))
          (f64.store
           (local.get $tmp1)
           (f64.sub (local.get $t) (f64.mul (local.get $carry) (local.get $2^16))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   (local.set $i (i32.const 0))
   (local.set $tmp2 (i32.sub (local.get $instart) (local.get $inlen)))
   (loop $cont-i
     (if (i32.le_u (local.get $i) (local.get $tmp2))
         (then
          (f64.store (call $f64idx (local.get $man*) (local.get $i)) (f64.const 0))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   ;; write the result
   (local.set $tmp1 (i32.add (i32.add (local.get $inlen) (i32.const 1))
                             (local.get $instart)))
   (local.set $i (call $max (i32.const 0)
                       (i32.sub (i32.sub (local.get $inlen) (i32.const 1))
                                (local.get $instart))))
   (local.set $tmp2 (i32.sub (i32.add (local.get $prec) (local.get $inlen))
                             (i32.const 1)))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $tmp2))
         (then
          (i32.store
           (call $i32idx (local.get $man*) (i32.sub (local.get $i) (local.get $tmp1)))
           (i32.add
            (i32.trunc_f64_u
             (f64.load (call $reidx (local.get $bufa) (local.get $i))))
            (i32.shl
             (i32.trunc_f64_u
              (f64.load (call $imidx (local.get $bufa) (local.get $i))))
             (i32.const 16))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   ;; leave the last word as result
   (i32.add
    (i32.trunc_f64_u
     (f64.load (call $reidx (local.get $bufa) (local.get $i))))
    (i32.shl
     (i32.trunc_f64_u
      (f64.load (call $imidx (local.get $bufa) (local.get $i))))
     (i32.const 16))))

 (func $is_multiplied_by_convolution (export "is_multiplied_by_convolution")
   (param $inlen i32) (result i32)
   (i32.ge_s (local.get $inlen) (global.get $CONVTHRESH)))

 ;; sub_man_bscaled: Auxilliary function to help division.
 ;; - Arguments:
 ;;   - amsw (output) :: The most significant word of a.
 ;;   - aofs :: How many words a is shifted, with the msw's taken as 0, the first
 ;;             substituted by the amsw
 ;;   - res (output) :: the result is shifted aofs words
 ;;   - bscale :: assumed positive, < 32
 ;; - Returns:
 ;;   - boolean :: `false' is a was < b, possibly breaking with an incomplete res.
 (func $sub_man_bscaled
     (param $res* i32) (param $a* i32) (param $b* i32) (param $amsw* i32)
     (param $bscale i32) (param $inlen i32) (param $instart i32) (param $aofs i32)
     (result i32)
     (local $carry i32) (local $v i64) (local $u i32) (local $s i32) (local $tmp1 i32)
     (local $tmp2 i32) (local $ui i32)
     (local.set $carry (i32.const 0))
     (local.set $s (call $combinewords (i32.const 0)
                         (i32.load (call $i32idx (local.get $b*) (local.get $instart)))
                         (local.get $bscale)))
     (local.set $u (local.get $instart))
     (local.set $tmp1 (i32.add (local.get $instart) (local.get $aofs)))
     (loop $cont-u
       (if (i32.lt_s (local.get $u) (local.get $tmp1))
           (then
            (local.set $v
                       (i64.sub (i64.sub (i64.const 0) (i64.extend_i32_u (local.get $s)))
                                (i64.extend_i32_u (local.get $carry))))
            (i32.store (call $i32idx (local.get $res*) (local.get $u))
                       (i32.wrap_i64 (local.get $v)))
            (local.set $carry (i64.ne (i64.shr_u (local.get $v) (i64.const 32))
                                      (i64.const 0)))
            (local.set
             $s
             (call $combinewords
                   (i32.load (call $i32idx (local.get $b*) (local.get $u)))
                   (i32.load (call $i32idx (local.get $b*)
                                   (i32.add (local.get $u) (i32.const 1))))
                   (local.get $bscale)))
            (local.set $u (i32.add (local.get $u) (i32.const 1)))
            (br $cont-u))))
     ;; Subtract words
     (local.set $tmp1 (i32.sub (local.get $inlen) (i32.const 1)))
     (local.set $u (i32.const 0))
     (loop $cont-u
       (if (i32.lt_u (local.get $u) (local.get $tmp1))
           (then
            (local.set $ui (i32.add (local.get $u) (local.get $instart)))
            (local.set $tmp2 (call $i32idx (local.get $a*)
                                   (i32.sub (local.get $ui) (local.get $aofs))))
            (local.set $v (i64.sub
                           (i64.sub
                            (i64.extend_i32_u (i32.load (local.get $tmp2)))
                            (i64.extend_i32_u (local.get $s)))
                           (i64.extend_i32_u (local.get $carry))))
            (i32.store
             (call $i32idx (local.get $res*) (local.get $ui))
             (i32.wrap_i64 (local.get $v)))
            (local.set $carry (i64.ne (i64.shr_u (local.get $v) (i64.const 32))
                                      (i64.const 0)))
            (local.set $s (call $combinewords
                                (i32.load (call $i32idx (local.get $b*) (local.get $ui)))
                                (i32.load (call $i32idx (local.get $b*)
                                                (i32.add (local.get $ui) (i32.const 1))))
                                (local.get $bscale)))
            (local.set $u (i32.add (local.get $u) (i32.const 1)))
            (br $cont-u))))
     ;; {
     (local.set $ui (i32.add (local.get $u) (local.get $instart)))
     (local.set $tmp2 (call $i32idx (local.get $a*)
                            (i32.sub (local.get $ui) (local.get $aofs))))
     (local.set $v (i64.sub
                    (i64.sub
                     (i64.extend_i32_u (i32.load (local.get $tmp2)))
                     (i64.extend_i32_u (local.get $s)))
                    (i64.extend_i32_u (local.get $carry))))
     (i32.store
      (call $i32idx (local.get $res*) (local.get $ui))
      (i32.wrap_i64 (local.get $v)))
     (local.set $carry (i64.ne (i64.shr_u (local.get $v) (i64.const 32))
                               (i64.const 0)))
     (local.set $s (call $combinewords
                         (i32.load (call $i32idx (local.get $b*) (local.get $ui)))
                         (i32.const 0)
                         (local.get $bscale)))
     ;; }
     (local.set $v (i64.sub
                    (i64.sub
                     (i64.extend_i32_u (i32.load (local.get $amsw*)))
                     (i64.extend_i32_u (local.get $s)))
                    (i64.extend_i32_u (local.get $carry))))
     (local.set $carry (i64.ne (i64.shr_u (local.get $v) (i64.const 32))
                               (i64.const 0)))
     (if (result i32) (local.get $carry)
       (then (i32.const 0))
       (else
        (i32.store (local.get $amsw*) (i32.wrap_i64 (local.get $v)))
        (i32.const 1))))

 (func $combinewords
     (param $a i32) (param $b i32) (param $bscale i32) (result i32)
     (if (result i32) (local.get $bscale)
       (then
        (i32.add (i32.shr_u (local.get $a) (i32.sub (i32.const 32) (local.get $bscale)))
                 (i32.shl (local.get $b) (local.get $bscale))))
       (else
        (local.get $b))))

 (func $mantissa_div (export "mantissa_div")
   (param $man* i32) (param $a* i32) (param $b* i32) (param $instart i32)
   (param $inlen i32) (param $temp1* i32) (param $temp2* i32) (result i32)
   (local $kprec i32) (local $amsw* i32) (local $sc i32) (local $r i32)
   (local $e i32) (local $i i32) (local $j i32) (local $ofs i32) (local $k i32)
   (local $tmp1 i32) (local $tmp2 i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $amsw* (global.get $OFFSCR))
   (local.set $r (i32.const 0))
   (local.set $e (i32.const 1))
   (local.set $j (i32.sub (i32.add (local.get $instart) (local.get $inlen))
                          (i32.const 1)))
   (local.set $i (local.get $j))
   (local.set $ofs (i32.const 0))
   (local.set $k (i32.const 0))
   (loop $cont-k
     (if (i32.lt_s (local.get $k) (local.get $instart))
         (then
          (i32.store (call $i32idx (local.get $man*) (local.get $k)) (i32.const 0))
          (local.set $k (i32.add (local.get $k) (i32.const 1)))
          (br $cont-k))))
   (i32.store (local.get $amsw*) (i32.const 0))
   (block $exit-sc
     (local.set $sc (i32.const 31))
     (loop $cont-sc
       (if (i32.ge_s (local.get $sc) (i32.const 0))
           (then
            (if (call $sub_man_bscaled (local.get $temp1*) (local.get $a*) (local.get $b*)
                      (local.get $amsw*) (local.get $sc) (local.get $inlen)
                      (local.get $instart) (i32.const 0))
                (then (br $exit-sc)))
            (local.set $sc (i32.sub (local.get $sc) (i32.const 1)))
            (br $cont-sc)))))
   (if (i32.lt_s (local.get $sc) (i32.const 0))
       (then
        (local.set $e (i32.const 0))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (i32.store (local.get $amsw*)
                   (i32.load (call $i32idx (local.get $a*)
                                   (i32.add (i32.sub (local.get $inlen) (i32.const 1))
                                            (local.get $instart)))))
        (block $exit-sc
          (local.set $sc (i32.const 31))
          (loop $cont-sc
            (if (i32.ge_s (local.get $sc) (i32.const 0))
                (then
                 (if (call $sub_man_bscaled (local.get $temp1*) (local.get $a*) (local.get $b*)
                           (local.get $amsw*) (local.get $sc) (local.get $inlen)
                           (local.get $instart) (i32.const 1))
                     (then (br $exit-sc)))
                 (local.set $sc (i32.sub (local.get $sc) (i32.const 1)))
                 (br $cont-sc)))))
        ;; assert: (sc >= 0)
        ))
   (local.set $r (i32.or (local.get $r) (i32.shl (i32.const 1) (local.get $sc))))
   (loop $cont-j
     (if (i32.ge_s (local.get $j) (local.get $instart))
         (then
          (local.set $sc (i32.sub (local.get $sc) (i32.const 1)))
          (loop $cont-sc
            (if (i32.ge_s (local.get $sc) (i32.const 0))
                (then
                 (if (call $sub_man_bscaled (local.get $temp2*) (local.get $temp1*)
                           (local.get $b*) (local.get $amsw*) (local.get $sc)
                           (local.get $inlen) (local.get $instart) (i32.const 0))
                     (then
                      (local.set $r (i32.or (local.get $r)
                                            (i32.shl (i32.const 1) (local.get $sc))))
                      (local.set $tmp1 (local.get $temp1*))
                      (local.set $temp1* (local.get $temp2*))
                      (local.set $temp2* (local.get $tmp1))))
                 (local.set $sc (i32.sub (local.get $sc) (i32.const 1)))
                 (br $cont-sc))))
          (block $exit-scj
            (local.set $ofs (i32.const 0))
            (loop $cont-scj
              (if (i32.and (i32.lt_s (local.get $sc) (i32.const 0))
                           (i32.ge_s (local.get $j) (local.get $instart)))
                  (then
                   (local.set $ofs (i32.add (local.get $ofs) (i32.const 1)))
                   (local.set $sc (i32.const 32))
                   (local.set $i (i32.sub (local.get $i) (i32.const 1)))
                   (i32.store (call $i32idx (local.get $man*) (local.get $j))
                              (local.get $r))
                   (local.set $j (i32.sub (local.get $j) (i32.const 1)))
                   (if (i32.lt_s (local.get $j) (local.get $instart))
                       (then (br $exit-scj)))
                   (local.set $tmp1 (i32.add
                                     (i32.sub (local.get $inlen) (local.get $ofs))
                                     (local.get $instart)))
                   (i32.store (local.get $amsw*)
                              (i32.load
                               (call $i32idx (local.get $temp1*) (local.get $tmp1))))
                   (block $exit-sc
                     (local.set $r (i32.const 0))
                     (local.set $sc (i32.const 31))
                     (loop $cont-sc
                       (if (i32.ge_s (local.get $sc) (i32.const 0))
                           (then
                            (if (call $sub_man_bscaled
                                      (local.get $temp2*) (local.get $temp1*)
                                      (local.get $b*) (local.get $amsw*)
                                      (local.get $sc) (local.get $inlen)
                                      (local.get $instart) (local.get $ofs))
                                (then
                                 (local.set $r (i32.or (local.get $r)
                                                       (i32.shl (i32.const 1)
                                                                (local.get $sc))))
                                 (local.set $tmp1 (local.get $temp1*))
                                 (local.set $temp1* (local.get $temp2*))
                                 (local.set $temp2* (local.get $tmp1))
                                 (br $exit-sc)))
                            (local.set $sc (i32.sub (local.get $sc) (i32.const 1)))
                            (br $cont-sc)))))
                   (br $cont-scj)))))
          (br $cont-j))))
   ;; check if we need to round up
   (if (call $sub_man_bscaled (local.get $temp2*) (local.get $temp1*) (local.get $b*)
             (local.get $amsw*) (i32.const 31) (local.get $inlen) (local.get $instart)
             (local.get $ofs))
       (then
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (loop $cont-j
          (if (i32.lt_s (local.get $j) (local.get $kprec))
              (then
               (local.set $tmp1 (call $i32idx (local.get $man*) (local.get $j)))
               (local.set $tmp2 (i32.add (i32.load (local.get $tmp1)) (i32.const 1)))
               (i32.store (local.get $tmp1) (local.get $tmp2))
               (if (i32.eqz (local.get $tmp2))
                   (then
                    (local.set $j (i32.add (local.get $j) (i32.const 1)))
                    (br $cont-j))))))
        (if (i32.eq (local.get $j) (local.get $kprec))
            (then
             ;; carry on msw means we have 1(0)
             (local.set $e (i32.add (local.get $e) (i32.const 1)))
             (i32.store
              (call $i32idx (local.get $man*) (i32.sub (local.get $j) (i32.const 1)))
              (i32.const 1))))))
   (local.get $e))

 ;; mantissa_scale : multiplication by u32 multiplier
 ;; - Can be faster than mantissa-mul
 (func $mantissa_scale (export "mantissa_scale")
   (param $man* i32) (param $src* i32) (param $multiplier i32) (result i32)
   (local $kprec i32) (local $v i64) (local $i i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $v (i64.const 0))
   (local.set $i (i32.const 0))
   (loop $cont-i
     (if (i32.lt_u (local.get $i) (local.get $kprec))
         (then
          (local.set
           $v
           (i64.add
            (local.get $v)
            (i64.mul
             (i64.extend_i32_u
              (i32.load (call $i32idx (local.get $src*) (local.get $i))))
             (i64.extend_i32_u (local.get $multiplier)))))
          (i32.store
           (call $i32idx (local.get $man*) (local.get $i))
           (i32.wrap_i64
            (i64.and (local.get $v) (i64.const 0xFFFFFFFF))))
          (local.set $v (i64.shr_u (local.get $v) (i64.const 32)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   (i32.wrap_i64 (local.get $v)))

 ;; mantissa_invscale : division by u32 divisor
 ;; - Can be faster than mantissa-div
 (func $mantissa_invscale (export "mantissa_invscale")
   (param $man* i32) (param $src* i32) (param $divisor i32) (result i32)
   (local $kprec i32) (local $i i32) (local $j i32) (local $e i32) (local $v i64)
   (local $divisor64 i64) (local $tmp1 i32) (local $tmp2 i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $i (i32.sub (local.get $kprec) (i32.const 1)))
   (local.set $j (local.get $i))
   (local.set $e (i32.const 0))
   (local.set $v (i64.extend_i32_u (i32.load (call $i32idx (local.get $src*)
                                                   (local.get $i)))))
   (local.set $divisor64 (i64.extend_i32_u (local.get $divisor)))
   (if (i64.lt_u (local.get $v) (local.get $divisor64))
       (then
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (local.set
         $v (i64.add
             (i64.extend_i32_u (i32.load (call $i32idx (local.get $src*) (local.get $i))))
             (i64.shl (local.get $v) (i64.const 32))))
        (local.set $e (i32.const -1))))
   (loop $cont-i
     (if (i32.gt_s (local.get $i) (i32.const 0))
         (then
          (i32.store (call $i32idx (local.get $man*) (local.get $j))
                     (i32.wrap_i64 (i64.div_u (local.get $v) (local.get $divisor64))))
          (local.set $j (i32.sub (local.get $j) (i32.const 1)))
          (local.set $i (i32.sub (local.get $i) (i32.const 1)))
          (local.set
           $v
           (i64.add
            (i64.shl (i64.rem_u (local.get $v) (local.get $divisor64)) (i64.const 32))
            (i64.extend_i32_u (i32.load (call $i32idx (local.get $src*) (local.get $i))))))
          (br $cont-i))))
   (i32.store (call $i32idx (local.get $man*) (local.get $j))
              (i32.wrap_i64 (i64.div_u (local.get $v) (local.get $divisor64))))
   (local.set $j (i32.sub (local.get $j) (i32.const 1)))
   (if (i32.eqz (local.get $j)) ;; this would happen if msw in src was < divisor
       (then
        (local.set $v (i64.shl (i64.rem_u (local.get $v) (local.get $divisor64))
                               (i64.const 32)))
        (i32.store (call $i32idx (local.get $man*) (local.get $j))
                   (i32.wrap_i64 (i64.div_u (local.get $v) (local.get $divisor64))))
        (local.set $j (i32.sub (local.get $j) (i32.const 1)))))
   ;; round the result; j is -1
   (if (i64.gt_u (i64.rem_u (local.get $v) (local.get $divisor64))
                 (i64.div_u (local.get $divisor64) (i64.const 2)))
       (then
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (loop $cont-j
          (if (i32.lt_s (local.get $j) (local.get $kprec))
              (then
               (local.set $tmp1 (call $i32idx (local.get $man*) (local.get $j)))
               (local.set $tmp2 (i32.add (i32.load (local.get $tmp1)) (i32.const 1)))
               (i32.store (local.get $tmp1) (local.get $tmp2))
               (if (i32.eqz (local.get $tmp2))
                   (then
                    (local.set $j (i32.add (local.get $j) (i32.const 1)))
                    (br $cont-j))))))
        (if (i32.eq (local.get $j) (local.get $kprec))
            (then
             (local.set $e (i32.add (local.get $e) (i32.const 1)))
             (i32.store
              (call $i32idx (local.get $man*) (i32.sub (local.get $j) (i32.const 1)))
              (i32.const 1))))))
   (local.get $e))

 ;; binary scale mantissa, i.e. multiply by 1<<scale, where scale < 32
 (func $mantissa-bscale (export "mantissa_bscale")
   (param $man* i32) (param $src* i32) (param $scale i32) (result i32)
   (local $kprec i32) (local $v i32) (local $i i32) (local $tmp1 i32)
   (local.set $kprec (global.get $KERNPREC))
   (local.set $v (i32.const 0))
   (local.set $i (i32.const 0))
   (loop $cont-i
     (if (i32.lt_s (local.get $i) (local.get $kprec))
         (then
          (local.set $tmp1 (i32.load (call $i32idx (local.get $src*) (local.get $i))))
          (i32.store
           (call $i32idx (local.get $man*) (local.get $i))
           (i32.or (i32.shl (local.get $tmp1) (local.get $scale)) (local.get $v)))
          (local.set $v (i32.shr_u (local.get $tmp1)
                                   (i32.sub (i32.const 32) (local.get $scale))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br $cont-i))))
   (local.get $v))


 ;; ============================================================================
 ;; ----- Convolution -----
 ;; ============================================================================

 ;; In-place convolution.
 ;; - argument `a' will contain the result.
 ;; - argument `b' will be used as working space.
 (func $convolve (export "convolve")
   (param $a* i32) (param $b* i32) (param $size i32)
   (local $wstride i32) (local $one/4size f64) (local $tmpa i32) (local $tmpb i32)
   (if (i32.eqz (local.get $size))
       (then
        (local.set $size (global.get $CONVSZ))
        (local.set $wstride (i32.const 1)))
     (else
      (local.set $wstride (i32.div_u (global.get $CONVSZ) (local.get $size)))))
   ;; forward ffts. remember rc multiplies both by additional factor of 2
   (call $fft_fwd_ip_rc (local.get $size) (local.get $a*) (local.get $wstride))
   (call $fft_fwd_ip_rc (local.get $size) (local.get $b*) (local.get $wstride))
   (local.set $one/4size (f64.div (f64.const 1.0)
                                  (f64.mul (f64.convert_i32_u (local.get $size))
                                           (f64.const 4.0))))
   ;; DC and Nyquist share one complex value; should be multiplied separately
   (f64.store (local.get $a*) (f64.mul (f64.load (local.get $a*))
                                       (f64.mul (f64.load (local.get $b*))
                                                (local.get $one/4size))))
   (local.set $tmpa (call $f64idx (local.get $a*) (i32.const 1)))
   (local.set $tmpb (call $f64idx (local.get $b*) (i32.const 1)))
   (f64.store (local.get $tmpa) (f64.mul (f64.load (local.get $tmpa))
                                         (f64.mul (f64.load (local.get $tmpb))
                                                  (local.get $one/4size))))
   (local.set $tmpa (call $f64idx (local.get $a*) (i32.const 2)))
   (local.set $tmpb (call $f64idx (local.get $b*) (i32.const 2)))
   (call $mul_complex (i32.sub (i32.shr_u (local.get $size) (i32.const 1)) (i32.const 1))
         (local.get $tmpa) (local.get $tmpb) (local.get $one/4size))
   ;; inverse fft
   (call $fft_inv_ip_cr (local.get $size) (local.get $a*) (local.get $wstride)))

 (func $conv_init
     (param $size i32) (result i32)
     (local $i i32) (local $bitsm1 i32) (local $size/2 i32) (local $offw i32)
     (local $offb i32) (local $i_f64 f64) (local $pi/size f64)
     ;; TODO: Need grow the memory if size is too big. Should we? check RealLib
     ;;       Raise an exception for now.
     (if (i32.gt_u (local.get $size) (global.get $CONVMAXSZ))
         ;; `size' too big
         (then
          (call $raise1 (i32.const 3) (i32.const 2) (local.get $size))))
     (if (call $is_not_pow2 (local.get $size))
         ;; `size' must be a power of 2
         (then
          (call $raise1 (i32.const 2) (i32.const 2) (local.get $size))))
     (global.set $CONVSZ (local.get $size))
     ;; Fill in weights and bit reverse vector
     (local.set $i (i32.const 0))
     (local.set $pi/size (f64.div (global.get $PI2) (f64.convert_i32_u (local.get $size))))
     (local.set $bitsm1 (i32.sub (call $log2_pow2 (local.get $size)) (i32.const 1)))
     (local.set $size/2 (i32.shr_u (local.get $size) (i32.const 1)))
     (local.set $offw (global.get $OFFCVW))
     (local.set $offb (global.get $OFFCVB))
     (loop $cont
       (if (i32.lt_u (local.get $i) (local.get $size/2))
           (then
            (local.set $i_f64 (f64.convert_i32_u (local.get $i)))
            (call $reidx (local.get $offw) (local.get $i))
            (call $cos (f64.mul (local.get $i_f64) (local.get $pi/size)))
            f64.store
            (call $imidx (local.get $offw) (local.get $i))
            (call $sin (f64.mul (local.get $i_f64) (local.get $pi/size)))
            f64.neg
            f64.store
            (call $i32idx(local.get $offb) (local.get $i))
            (call $reverse_bits (local.get $i) (local.get $bitsm1))
            i32.store
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $cont))))
     (local.get $size))

 ;; multiply two complex vectors, in-place
 (func $mul_complex
     (param $size i32) (param $a* i32) (param $b* i32) (param $scale f64)
     (local $i i32) (local $are f64) (local $aim f64) (local $bre f64) (local $bim f64)
     (local.set $i (i32.const 0))
     (loop $cont
       (if (i32.lt_u (local.get $i) (local.get $size))
           (then
            (local.set $are (f64.load (call $reidx (local.get $a*) (local.get $i))))
            (local.set $aim (f64.load (call $imidx (local.get $a*) (local.get $i))))
            (local.set $bre (f64.load (call $reidx (local.get $b*) (local.get $i))))
            (local.set $bim (f64.load (call $imidx (local.get $b*) (local.get $i))))
            (call $reidx (local.get $a*) (local.get $i))
            (f64.mul
             (f64.sub (f64.mul (local.get $are) (local.get $bre))
                      (f64.mul (local.get $aim) (local.get $bim)))
             (local.get $scale))
            f64.store
            (call $imidx (local.get $a*) (local.get $i))
            (f64.mul
             (f64.add (f64.mul (local.get $are) (local.get $bim))
                      (f64.mul (local.get $aim) (local.get $bre)))
             (local.get $scale))
            f64.store
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $cont)))))

 ;; fft_fwd_ip : Gentleman-Sande decimation-in-frequency forward in-place fft
 (func $fft_fwd_ip
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $L i32) (local $j i32) (local $k i32) (local $r i32) (local $L2 i32)
     (local $ws* i32) (local $wr f64) (local $wi f64) (local $cr f64) (local $ci f64)
     (local $dr f64) (local $di f64) (local $tmp1 i32) (local $tmp2 i32)
     (local.set $ws* (global.get $OFFCVW))
     (local.set $L (local.get $size))
     (local.set $r (i32.const 1))
     (loop $cont_L
       (if (i32.gt_u (local.get $L) (i32.const 1))
           (then
            (local.set $L2 (i32.shr_u (local.get $L) (i32.const 1)))
            (local.set $j (i32.const 0))
            (loop $cont_j
              (if (i32.lt_u (local.get $j) (local.get $L2))
                  (then
                   (local.set $tmp1 (i32.mul
                                     (local.get $j)
                                     (i32.mul (local.get $r) (local.get $wstride))))
                   (local.set $wr (f64.load (call $reidx (local.get $ws*)
                                                  (local.get $tmp1))))
                   (local.set $wi (f64.load (call $imidx (local.get $ws*)
                                                  (local.get $tmp1))))
                   (local.set $k (i32.const 0))
                   (loop $cont_k
                     (if (i32.lt_u (local.get $k) (local.get $r))
                         (then
                          (local.set $tmp1 (i32.add
                                            (i32.mul (local.get $k) (local.get $L))
                                            (local.get $j)))
                          (local.set $tmp2 (i32.add (local.get $tmp1) (local.get $L2)))
                          (call $reidx (local.get $a*) (local.get $tmp1))
                          (f64.load (call $reidx (local.get $a*) (local.get $tmp1)))
                          (local.tee $cr)
                          (f64.load (call $reidx (local.get $a*) (local.get $tmp2)))
                          (local.tee $dr)
                          f64.add
                          f64.store
                          (call $imidx (local.get $a*) (local.get $tmp1))
                          (f64.load (call $imidx (local.get $a*) (local.get $tmp1)))
                          (local.tee $ci)
                          (f64.load (call $imidx (local.get $a*) (local.get $tmp2)))
                          (local.tee $di)
                          f64.add
                          f64.store
                          (local.set $cr (f64.sub (local.get $cr) (local.get $dr)))
                          (local.set $ci (f64.sub (local.get $ci) (local.get $di)))
                          (call $reidx (local.get $a*) (local.get $tmp2))
                          (f64.sub (f64.mul (local.get $wr) (local.get $cr))
                                   (f64.mul (local.get $wi) (local.get $ci)))
                          f64.store
                          (call $imidx (local.get $a*) (local.get $tmp2))
                          (f64.add (f64.mul (local.get $wr) (local.get $ci))
                                   (f64.mul (local.get $wi) (local.get $cr)))
                          f64.store
                          (local.set $k (i32.add (local.get $k) (i32.const 1)))
                          (br $cont_k))))
                   (local.set $j (i32.add (local.get $j) (i32.const 1)))
                   (br $cont_j))))
            (local.set $r (i32.shl (local.get $r) (i32.const 1)))
            (local.set $L (local.get $L2))
            (br $cont_L)))))

 ;; fft_inv_ip: Cooley-Tukey decimation-in-time inverse in-place fft
 (func $fft_inv_ip
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $L i32) (local $j i32) (local $k i32) (local $r i32) (local $L2 i32)
     (local $ws* i32) (local $wr f64) (local $wi f64) (local $cr f64) (local $ci f64)
     (local $dr f64) (local $di f64) (local $tmp1 i32) (local $tmp2 i32)
     (local $tr f64) (local $ti f64)
     (local.set $ws* (global.get $OFFCVW))
     (local.set $L (i32.const 2))
     (local.set $L2 (i32.const 1))
     (local.set $r (local.get $size))
     (loop $cont_L
       (if (i32.le_u (local.get $L) (local.get $size))
           (then
            (local.set $r (i32.shr_u (local.get $r) (i32.const 1)))
            (local.set $L2 (i32.shr_u (local.get $L) (i32.const 1)))
            (local.set $j (i32.const 0))
            (loop $cont_j
              (if (i32.lt_u (local.get $j) (local.get $L2))
                  (then
                   (local.set $tmp1 (i32.mul
                                     (local.get $j)
                                     (i32.mul (local.get $r) (local.get $wstride))))
                   (local.set $wr (f64.load (call $reidx (local.get $ws*)
                                                  (local.get $tmp1))))
                   (local.set $wi (f64.neg (f64.load (call $imidx (local.get $ws*)
                                                           (local.get $tmp1)))))
                   (local.set $k (i32.const 0))
                   (loop $cont_k
                     (if (i32.lt_u (local.get $k) (local.get $r))
                         (then
                          (local.set $tmp1 (i32.add
                                            (i32.mul (local.get $k) (local.get $L))
                                            (local.get $j)))
                          (f64.load (call $reidx (local.get $a*) (local.get $tmp1)))
                          (local.set $cr)
                          (f64.load (call $imidx (local.get $a*) (local.get $tmp1)))
                          (local.tee $ci)
                          (local.set $tmp2 (i32.add (local.get $tmp1) (local.get $L2)))
                          (f64.load (call $reidx (local.get $a*) (local.get $tmp2)))
                          (local.set $dr)
                          (f64.load (call $imidx (local.get $a*) (local.get $tmp2)))
                          (local.set $di)
                          (local.set $tr (f64.sub (f64.mul (local.get $wr)
                                                           (local.get $dr))
                                                  (f64.mul (local.get $wi)
                                                           (local.get $di))))
                          (local.set $ti (f64.add (f64.mul (local.get $wr)
                                                           (local.get $di))
                                                  (f64.mul (local.get $wi)
                                                           (local.get $dr))))
                          (call $reidx (local.get $a*) (local.get $tmp1))
                          (f64.add (local.get $cr) (local.get $tr))
                          f64.store
                          (call $imidx (local.get $a*) (local.get $tmp1))
                          (f64.add (local.get $ci) (local.get $ti))
                          f64.store
                          (call $reidx (local.get $a*) (local.get $tmp2))
                          (f64.sub (local.get $cr) (local.get $tr))
                          f64.store
                          (call $imidx (local.get $a*) (local.get $tmp2))
                          (f64.sub (local.get $ci) (local.get $ti))
                          f64.store
                          (local.set $k (i32.add (local.get $k) (i32.const 1)))
                          (br $cont_k))))
                   (local.set $j (i32.add (local.get $j) (i32.const 1)))
                   (br $cont_j))))
            (local.set $L (i32.shl (local.get $L) (i32.const 1)))
            (br $cont_L)))))

 ;; Real-to-Complex step after fft_fwd
 ;;  the result is multiplied by 2
 (func $fft_real_to_complex
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $ws* i32) (local $br* i32) (local $size/2_ws i32)
     (local $pr f64) (local $pi f64) (local $mr f64) (local $mi f64)
     (local $i i32) (local $j i32) (local $tmp1 i32) (local $tmp2 i32)
     (local $rei i32) (local $imi i32) (local $rej i32) (local $imj i32)
     (local $wrei f64) (local $wimi f64)
     (local.set $size/2_ws (i32.mul (i32.shr_u (local.get $size) (i32.const 1))
                                    (local.get $wstride)))
     (local.set $ws* (global.get $OFFCVW))
     (local.set $br* (global.get $OFFCVB))
     ;; calculate DC and Nyquist (the value at the center frequency) both are real
     ;; numbers, to avoid needing extra space they share one complex point
     (local.set $tmp1 (call $reidx (local.get $a*) (i32.const 0)))
     (local.set $tmp2 (call $imidx (local.get $a*) (i32.const 0)))
     (local.set $pr (f64.load (local.get $tmp1)))
     (local.set $pi (f64.load (local.get $tmp2)))
     (f64.store (local.get $tmp1) (f64.mul (f64.add (local.get $pr) (local.get $pi))
                                           (f64.const 2.0)))
     (f64.store (local.get $tmp2) (f64.mul (f64.sub (local.get $pr) (local.get $pi))
                                           (f64.const 2.0)))
     ;; this is in the middle, reverse_bit(size/2) == 1
     (local.set $tmp1 (call $reidx (local.get $a*) (i32.const 1)))
     (local.set $tmp2 (call $imidx (local.get $a*) (i32.const 1)))
     (local.set $mr (f64.load (local.get $tmp1)))
     (local.set $mi (f64.load (local.get $tmp2)))
     (f64.store (local.get $tmp1) (f64.mul (local.get $mr) (f64.const 2)))
     (f64.store (local.get $tmp2) (f64.mul (local.get $mi) (f64.const -2)))
     ;; from here on, indexes are retrieved bit-reversed
     ;;  br(i*wstride) is the proper br(i) when the size is divided by wstride
     (local.set $i (local.get $wstride))
     (local.set $j (i32.mul (i32.sub (local.get $size) (i32.const 1)) (local.get $wstride)))
     (loop $cont
       (if (i32.lt_u (local.get $i) (local.get $size/2_ws))
           (then
            (local.set $tmp1 (i32.load (call $i32idx (local.get $br*) (local.get $i))))
            (local.set $rei (call $reidx (local.get $a*) (local.get $tmp1)))
            (local.set $imi (call $imidx (local.get $a*) (local.get $tmp1)))
            (local.set $tmp2 (i32.load (call $i32idx (local.get $br*) (local.get $j))))
            (local.set $rej (call $reidx (local.get $a*) (local.get $tmp2)))
            (local.set $imj (call $imidx (local.get $a*) (local.get $tmp2)))
            (local.set $pr (f64.add (f64.load (local.get $rei))
                                    (f64.load (local.get $rej))))
            (local.set $pi (f64.add (f64.load (local.get $imi))
                                    (f64.load (local.get $imj))))
            (local.set $mr (f64.sub (f64.load (local.get $rei))
                                    (f64.load (local.get $rej))))
            (local.set $mi (f64.sub (f64.load (local.get $imi))
                                    (f64.load (local.get $imj))))
            (local.set $wrei (f64.load (call $reidx (local.get $ws*) (local.get $i))))
            (local.set $wimi (f64.load (call $imidx (local.get $ws*) (local.get $i))))
            (local.get $rei)
            (f64.add
             (f64.add
              (local.get $pr)
              (f64.mul (local.get $wrei) (local.get $pi)))
             (f64.mul (local.get $wimi) (local.get $mr)))
            f64.store
            (local.get $imi)
            (f64.add
             (f64.sub
              (local.get $mi)
              (f64.mul (local.get $wrei) (local.get $mr)))
             (f64.mul (local.get $wimi) (local.get $pi)))
            f64.store
            (local.get $rej)
            (f64.sub
             (f64.sub
              (local.get $pr)
              (f64.mul (local.get $wrei) (local.get $pi)))
             (f64.mul (local.get $wimi) (local.get $mr)))
            f64.store
            (local.get $imj)
            (f64.sub
             (f64.sub
              (f64.mul (local.get $wimi) (local.get $pi))
              (local.get $mi))
             (f64.mul (local.get $wrei) (local.get $mr)))
            f64.store
            (local.set $i (i32.add (local.get $i) (local.get $wstride)))
            (local.set $j (i32.sub (local.get $j) (local.get $wstride)))
            (br $cont)))))

 ;; Complex-to-Real step before fft_inv
 (func $fft_complex_to_real
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $ws* i32) (local $br* i32) (local $size/2_ws i32)
     (local $pr f64) (local $pi f64) (local $mr f64) (local $mi f64)
     (local $i i32) (local $j i32) (local $tmp1 i32) (local $tmp2 i32)
     (local $rei i32) (local $imi i32) (local $rej i32) (local $imj i32)
     (local $wrei f64) (local $wimi f64) (local $zr f64) (local $zi f64)
     (local.set $size/2_ws (i32.mul (i32.shr_u (local.get $size) (i32.const 1))
                                    (local.get $wstride)))
     (local.set $ws* (global.get $OFFCVW))
     (local.set $br* (global.get $OFFCVB))
     ;; DC and Nyquist were calculated using a different formula
     (local.set $tmp1 (call $reidx (local.get $a*) (i32.const 0)))
     (local.set $tmp2 (call $imidx (local.get $a*) (i32.const 0)))
     (local.set $pr (f64.load (local.get $tmp1)))
     (local.set $pi (f64.load (local.get $tmp2)))
     (f64.store (local.get $tmp1) (f64.add (local.get $pr) (local.get $pi)))
     (f64.store (local.get $tmp2) (f64.sub (local.get $pr) (local.get $pi)))
     ;; this is in the middle, reverse_bit(size/2) == 1
     (local.set $tmp1 (call $reidx (local.get $a*) (i32.const 1)))
     (local.set $tmp2 (call $imidx (local.get $a*) (i32.const 1)))
     (local.set $mr (f64.load (local.get $tmp1)))
     (local.set $mi (f64.load (local.get $tmp2)))
     (f64.store (local.get $tmp1) (f64.mul (local.get $mr) (f64.const 2)))
     (f64.store (local.get $tmp2) (f64.mul (local.get $mi) (f64.const -2)))
     ;; from here on, indexes are retrieved bit-reversed
     (local.set $i (local.get $wstride))
     (local.set $j (i32.mul (i32.sub (local.get $size) (i32.const 1))
                            (local.get $wstride)))
     (loop $cont
       (if (i32.lt_u (local.get $i) (local.get $size/2_ws))
           (then
            (local.set $tmp1 (i32.load (call $i32idx (local.get $br*) (local.get $i))))
            (local.set $rei (call $reidx (local.get $a*) (local.get $tmp1)))
            (local.set $imi (call $imidx (local.get $a*) (local.get $tmp1)))
            (local.set $tmp2 (i32.load (call $i32idx (local.get $br*) (local.get $j))))
            (local.set $rej (call $reidx (local.get $a*) (local.get $tmp2)))
            (local.set $imj (call $imidx (local.get $a*) (local.get $tmp2)))
            (local.set $pr (f64.add (f64.load (local.get $rei))
                                    (f64.load (local.get $rej))))
            (local.set $pi (f64.sub (f64.load (local.get $imi))
                                    (f64.load (local.get $imj))))
            (local.set $mi (f64.sub (f64.load (local.get $rei))
                                    (f64.load (local.get $rej))))
            (local.set $mr (f64.add (f64.load (local.get $imi))
                                    (f64.load (local.get $imj))))
            (local.set $wrei (f64.load (call $reidx (local.get $ws*) (local.get $i))))
            (local.set $wimi (f64.load (call $imidx (local.get $ws*) (local.get $i))))
            (local.set $zr (f64.sub (f64.mul (local.get $mr) (local.get $wrei))
                                    (f64.mul (local.get $mi) (local.get $wimi))))
            (local.set $zi (f64.add (f64.mul (local.get $mi) (local.get $wrei))
                                    (f64.mul (local.get $mr) (local.get $wimi))))
            (f64.store (local.get $rei) (f64.sub (local.get $pr) (local.get $zr)))
            (f64.store (local.get $imi) (f64.add (local.get $pi) (local.get $zi)))
            (f64.store (local.get $rej) (f64.add (local.get $pr) (local.get $zr)))
            (f64.store (local.get $imj) (f64.sub (local.get $zi) (local.get $pi)))
            (local.set $i (i32.add (local.get $i) (local.get $wstride)))
            (local.set $j (i32.sub (local.get $j) (local.get $wstride)))
            (br $cont)))))

 (func $fft_fwd_ip_rc
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $ws* i32) (local $br* i32) (local $s/2 i32) (local $w2 i32)
     (local.set $s/2 (i32.shr_u (local.get $size) (i32.const 1)))
     (local.set $w2 (i32.shl (local.get $wstride) (i32.const 1)))
     ;; perform a complex-to-complex fft on the data
     (call $fft_fwd_ip (local.get $s/2) (local.get $a*) (local.get $w2))
     ;; then use an additional step to get the actual result
     (call $fft_real_to_complex (local.get $s/2) (local.get $a*) (local.get $wstride)))

 (func $fft_inv_ip_cr
     (param $size i32) (param $a* i32) (param $wstride i32)
     (local $ws* i32) (local $br* i32) (local $s/2 i32) (local $w2 i32)
     (local.set $s/2 (i32.shr_u (local.get $size) (i32.const 1)))
     (local.set $w2 (i32.shl (local.get $wstride) (i32.const 1)))
     ;; revert the operation of fft_real_to_complex
     (call $fft_complex_to_real (local.get $s/2) (local.get $a*) (local.get $wstride))
     ;; perform a complex-to-complex fft
     (call $fft_inv_ip (local.get $s/2) (local.get $a*) (local.get $w2)))


 ;; ============================================================================
 ;; ----- Other Math -----
 ;; ============================================================================

 ;; This does not handle Infinity. For our purposes, that case will be handled separately
 (func $frexp (export "frexp")
   (param $x f64) (param $e* i32) (result f64)
   (local $i i64) (local $ee i32)
   (i64.reinterpret_f64 (local.get $x))
   (local.tee $i)
   (i64.shr_u (i64.const 52))
   (i64.and (i64.const 0x7ff))
   i32.wrap_i64
   (local.tee $ee)
   i32.eqz
   (if (result f64)
       (then
        (if (f64.ne (local.get $x) (f64.const 0))
            (then
             (local.set $x (call $frexp (f64.mul (local.get $x) (f64.const 0x1p64))
                                 (local.get $e*)))
             (i32.store (local.get $e*) (i32.sub (i32.load (local.get $e*))
                                                 (i32.const 64))))
          (else
           (i32.store (local.get $e*) (i32.const 0))))
        (local.get $x))
     (else
      (i32.store (local.get $e*) (i32.sub (local.get $ee) (i32.const 0x3fe)))
      (f64.reinterpret_i64 (i64.or (i64.and (local.get $i)
                                            (i64.const 0x800fffffffffffff))
                                   (i64.const 0x3fe0000000000000))))))

 (func $trunc32 (export "trunc32")
   (param $x f64) (result i32)
   (i32.wrap_i64 (i64.trunc_f64_s (local.get $x))))


 ;; ============================================================================
 ;; ----- ErrorEstimate Helpers -----
 ;; ============================================================================

 (func $ee_mul (export "ee_mul")
   (param $mts i32) (param $mtsrhs i32) (param $e i32) (param $mts* i32) (result i32)
   (local $m i64)
   ;; Multiply. the result will at least have 1 in 62nd position at most 1 in 63rd
   (local.set $m (i64.mul (i64.extend_i32_u (local.get $mts))
                          (i64.extend_i32_u (local.get $mtsrhs))))
   ;; Round up if necessary
   (if (i32.wrap_i64 (i64.and (i64.shl (local.get $m) (i64.const 1))
                              (i64.const 0xffffffff)))
       (then
        (local.set $m (i64.add (i64.shr_u (local.get $m) (i64.const 31)) (i64.const 1))))
     (else
      (local.set $m (i64.shr_u (local.get $m) (i64.const 31)))))
   ;; Make room for the 63rd bit if it is not 0
   (if (i64.ne (i64.shr_u (local.get $m) (i64.const 31)) (i64.const 0))
       (then
        (if (i64.ne (i64.and (local.get $m) (i64.const 1)) (i64.const 0))
            (then
             (local.set $m (i64.add (local.get $m) (i64.const 1)))))
        (local.set $m (i64.shr_u (local.get $m) (i64.const 1)))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))))
   (i32.store (local.get $mts*) (i32.wrap_i64 (local.get $m)))
   (local.get $e))


 (func $ee_recip (export "ee_recip")
   (param $mts i32) (param $mts* i32)
   (i32.store (local.get $mts*)
              (i32.wrap_i64
               (i64.div_u
                (i64.sub (i64.add (i64.shl (i64.const 1) (i64.const 62))
                                  (i64.extend_i32_u (local.get $mts)))
                         (i64.const 1))
                (i64.extend_i32_u (local.get $mts))))))


 ;; ============================================================================
 ;; ----- Helpers -----
 ;; ============================================================================

 ;; log2 when argument is a power of 2
 (func $log2_pow2
     (param $n i32) (result i32)
     (i32.sub (i32.const 31) (i32.clz (local.get $n))))

 (func $is_not_pow2
     (param $a i32) (result i32)
     (i32.or
      (i32.lt_u (local.get $a) (i32.const 2))
      (i32.and (local.get $a) (i32.sub (local.get $a) (i32.const 1)))))

 (func $f64idx
     (param $off i32) (param $i i32) (result i32)
     (i32.add (local.get $off) (i32.mul (local.get $i) (i32.const 8))))

 (func $i32idx
     (param $off i32) (param $i i32) (result i32)
     (i32.add (local.get $off) (i32.mul (local.get $i) (i32.const 4))))

 (func $reidx
     (param $off i32) (param $i i32) (result i32)
     (i32.add (local.get $off) (i32.mul (local.get $i) (i32.const 16))))

 (func $imidx
     (param $off i32) (param $i i32) (result i32)
     local.get $off
     local.get $i
     call $reidx
     i32.const 8
     i32.add)

 (func $nextf64idx
     (param $i i32) (result i32)
     (i32.add (local.get $i) (i32.const 8)))

 (func $max
     (param $a i32) (param $b i32) (result i32)
     (select
      (local.get $a)
      (local.get $b)
      (i32.ge_s (local.get $a) (local.get $b))))

 (func $reverse_bits
     (param $z i32) (param $bits i32) (result i32)
     (local $mask i32) (local $s i32)
     (local.set $mask (i32.const -1))
     (local.set $s (i32.const 32))
     (loop $cont
       (local.set $s (i32.shr_u (local.get $s) (i32.const 1)))
       (if (i32.gt_u (local.get $s) (i32.const 0))
           (then
            (i32.xor (local.get $mask) (i32.shl (local.get $mask) (local.get $s)))
            local.tee $mask
            (i32.shr_u (local.get $z) (local.get $s))
            i32.and
            (i32.and (i32.shl (local.get $z) (local.get $s))
                     (i32.xor (local.get $mask) (i32.const -1)))
            i32.or
            local.set $z
            br $cont)))
     (i32.shr_u (local.get $z) (i32.sub (i32.const 32) (local.get $bits))))

 (func $round-mempage
     (param $bytes i32) (result i32)
     (local.get $bytes)
     (i32.const 65536)
     i32.add
     i32.const 1
     i32.sub
     (i32.const 65536)
     i32.div_u)

 (func $raise1
     (param $type i32) (param $source i32) (param $arg1 i32)
     (i32.store (i32.const 0) (local.get $arg1))
     (call $raise-js (local.get $type) (local.get $source) (i32.const 1)))
 )
