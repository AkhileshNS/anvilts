package main

import (
	"fmt"
	"sync"
)


// Channels for action synchronization
var (
	ch_consume = make(chan struct{}) // action: consume
	ch_get = make(chan struct{}) // action: get
	ch_put = make(chan struct{}) // action: put
	ch_start_produce = make(chan struct{}) // action: start_produce
)

// Process_PRODUCER implements the PRODUCER process
func Process_PRODUCER(wg *sync.WaitGroup) {
	defer wg.Done()
	fmt.Printf("[PRODUCER] Starting...\n")

	state := "PRODUCER_READY"

	for {
		switch state {
		case "PRODUCER_PRODUCING":
			<-ch_put // receive: put
			fmt.Printf("[PRODUCER] action: put (PRODUCING -> READY)\n")
			state = "PRODUCER_READY"
		case "PRODUCER_READY":
			ch_start_produce <- struct{}{} // action: start_produce
			fmt.Printf("[PRODUCER] action: start_produce (READY -> PRODUCING)\n")
			state = "PRODUCER_PRODUCING"
		default:
			fmt.Printf("[PRODUCER] Unknown state: %s\n", state)
			return
		}
	}
}

// Process_CONSUMER implements the CONSUMER process
func Process_CONSUMER(wg *sync.WaitGroup) {
	defer wg.Done()
	fmt.Printf("[CONSUMER] Starting...\n")

	state := "CONSUMER_WAITING"

	for {
		switch state {
		case "CONSUMER_CONSUMING":
			ch_consume <- struct{}{} // action: consume
			fmt.Printf("[CONSUMER] action: consume (CONSUMING -> WAITING)\n")
			state = "CONSUMER_WAITING"
		case "CONSUMER_WAITING":
			<-ch_get // receive: get
			fmt.Printf("[CONSUMER] action: get (WAITING -> CONSUMING)\n")
			state = "CONSUMER_CONSUMING"
		default:
			fmt.Printf("[CONSUMER] Unknown state: %s\n", state)
			return
		}
	}
}

// Process_BUFFER implements the BUFFER process
func Process_BUFFER(wg *sync.WaitGroup) {
	defer wg.Done()
	fmt.Printf("[BUFFER] Starting...\n")

	state := "BUFFER_EMPTY"

	for {
		switch state {
		case "BUFFER_EMPTY":
			ch_put <- struct{}{} // send: put
			fmt.Printf("[BUFFER] action: put (EMPTY -> FULL)\n")
			state = "BUFFER_FULL"
		case "BUFFER_FULL":
			ch_get <- struct{}{} // send: get
			fmt.Printf("[BUFFER] action: get (FULL -> EMPTY)\n")
			state = "BUFFER_EMPTY"
		default:
			fmt.Printf("[BUFFER] Unknown state: %s\n", state)
			return
		}
	}
}

// actionSink receives from non-shared action channels to prevent deadlock
func actionSink(wg *sync.WaitGroup) {
	defer wg.Done()
	for {
		select {
		case <-ch_consume:
			// sink for non-shared action: consume
		case <-ch_start_produce:
			// sink for non-shared action: start_produce
		}
	}
}

func main() {
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("  LTS Execution Started")
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()

	var wg sync.WaitGroup

	wg.Add(4)

	// Launch process goroutines
	go Process_PRODUCER(&wg)
	go Process_CONSUMER(&wg)
	go Process_BUFFER(&wg)

	// Launch action sink for non-shared actions
	go actionSink(&wg)

	// Wait for all processes to complete
	wg.Wait()

	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println("  LTS Execution Complete")
	fmt.Println("═══════════════════════════════════════════════════════════════")
}