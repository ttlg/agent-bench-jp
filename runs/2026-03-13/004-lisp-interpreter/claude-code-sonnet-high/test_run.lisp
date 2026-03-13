
(define (factorial n) (if (<= n 1) 1 (* n (factorial (- n 1)))))
(display (factorial 10))
(newline)

(define (make-counter)
  (let ((count 0))
    (lambda ()
      (set! count (+ count 1))
      count)))
(define c (make-counter))
(display (c)) (newline)
(display (c)) (newline)
(display (c)) (newline)

(define (loop n) (if (= n 0) "done" (loop (- n 1))))
(display (loop 1000000)) (newline)

(define-macro (when test . body) `(if ,test (begin ,@body)))
(when #t (display "macro works") (newline))

(display (map (lambda (x) (* x 2)) (quote (1 2 3 4 5)))) (newline)
(display (filter (lambda (x) (> x 3)) (quote (1 2 3 4 5)))) (newline)

