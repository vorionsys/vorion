# \TrustAPI

All URIs are relative to *https://app.agentanchorai.com/api/v1*

Method | HTTP request | Description
------------- | ------------- | -------------
[**ApplyTrustChange**](TrustAPI.md#ApplyTrustChange) | **Post** /agents/{id}/trust | Apply trust change
[**GetTrustHistory**](TrustAPI.md#GetTrustHistory) | **Get** /agents/{id}/trust | Get trust history



## ApplyTrustChange

> ApplyTrustChange200Response ApplyTrustChange(ctx, id).TrustChange(trustChange).Execute()

Apply trust change



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	id := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	trustChange := *openapiclient.NewTrustChange("AgentId_example", int32(123), "Reason_example", "Category_example") // TrustChange | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.TrustAPI.ApplyTrustChange(context.Background(), id).TrustChange(trustChange).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `TrustAPI.ApplyTrustChange``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ApplyTrustChange`: ApplyTrustChange200Response
	fmt.Fprintf(os.Stdout, "Response from `TrustAPI.ApplyTrustChange`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiApplyTrustChangeRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **trustChange** | [**TrustChange**](TrustChange.md) |  | 

### Return type

[**ApplyTrustChange200Response**](ApplyTrustChange200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetTrustHistory

> GetTrustHistory200Response GetTrustHistory(ctx, id).Limit(limit).Execute()

Get trust history



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/agentanchor/agentanchor-go"
)

func main() {
	id := "38400000-8cf0-11bd-b23e-10b96e4ef00d" // string | 
	limit := int32(56) // int32 |  (optional) (default to 50)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.TrustAPI.GetTrustHistory(context.Background(), id).Limit(limit).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `TrustAPI.GetTrustHistory``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetTrustHistory`: GetTrustHistory200Response
	fmt.Fprintf(os.Stdout, "Response from `TrustAPI.GetTrustHistory`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetTrustHistoryRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **limit** | **int32** |  | [default to 50]

### Return type

[**GetTrustHistory200Response**](GetTrustHistory200Response.md)

### Authorization

[BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

