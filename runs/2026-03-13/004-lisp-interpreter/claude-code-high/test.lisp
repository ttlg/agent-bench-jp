(define (fib n) (if (<= n 1) n (+ (fib (- n 1)) (fib (- n 2)))))
(display "fib(10) = ")
(display (fib 10))
(newline)

(define (make-counter)
  (let ((count 0))
    (lambda ()
      (set! count (+ count 1))
      count)))

(define c (make-counter))
(display "counter: ")
(display (c)) (display " ")
(display (c)) (display " ")
(display (c))
(newline)

(define-macro (when test . body)
  `(if ,test (begin ,@body)))

(when #t (display "macro works!") (newline))

(define (loop n)
  (if (= n 0) "done" (loop (- n 1))))
(display "TCO: ")
(display (loop 1000000))
(newline)
